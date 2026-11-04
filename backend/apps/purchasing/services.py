"""Purchasing operations. Every function runs in one transaction: either all records and stock movements are written, or none."""

from django.db import transaction
from django.db.models import Max, Sum

from apps.core.audit import audit
from apps.core.exceptions import ConflictError, DomainError
from apps.core.money import ZERO, q2
from apps.core.numbering import next_doc_no
from apps.core.tax import purchase_totals
from apps.inventory.models import Batch
from apps.inventory.stock import bucket_qty, lock_batches, post_movement
from apps.parties.models import Supplier

from .models import (
    GoodsReceipt,
    GRNLine,
    POLine,
    PurchaseOrder,
    SupplierPayment,
    SupplierReturn,
    SupplierReturnLine,
)


def _get_supplier(pk) -> Supplier:
    s = Supplier.objects.filter(pk=pk).first()
    if s is None:
        raise DomainError("Supplier not found.")
    return s


# --------------------------------- orders ---------------------------------


def pending_by_product(po: PurchaseOrder) -> dict[int, int]:
    """Quantity still to be received per product (ordered minus everything received so far)."""
    received = dict(
        GRNLine.objects.filter(receipt__po=po).values_list("product_id").annotate(t=Sum("qty")).values_list("product_id", "t")
    )
    return {l.product_id: max(0, l.qty - (received.get(l.product_id) or 0)) for l in po.lines.all()}


def _validate_po_lines(lines: list[dict]) -> None:
    from apps.catalog.models import Product

    if not lines:
        raise DomainError("Add at least one product line.")
    seen: set[int] = set()
    products = {p.pk: p for p in Product.objects.filter(pk__in=[l["product_id"] for l in lines])}
    for l in lines:
        p = products.get(l["product_id"])
        if p is None:
            raise DomainError("Product not found.")
        if l["product_id"] in seen:
            raise DomainError(f"{p.name} appears twice; combine the quantities.")
        seen.add(l["product_id"])
        if l["qty"] <= 0:
            raise DomainError("Quantity must be greater than zero.")
        if l["rate"] <= 0:
            raise DomainError("Rate must be greater than zero.")
        if not 0 <= l["gst_rate"] <= 100:
            raise DomainError("GST rate must be between 0 and 100.")


@transaction.atomic
def create_po(user, data: dict) -> PurchaseOrder:
    _get_supplier(data["supplier_id"])
    _validate_po_lines(data["lines"])
    po = PurchaseOrder.objects.create(
        po_no=next_doc_no("po", data["date"]), supplier_id=data["supplier_id"], date=data["date"],
        expected_date=data.get("expected_date"), status=data["status"], notes=data.get("notes", ""),
    )
    POLine.objects.bulk_create([POLine(po=po, **l) for l in data["lines"]])
    audit(user, "create", "Purchase order", po.po_no, f"Created purchase order {po.po_no}")
    return po


@transaction.atomic
def update_po(user, po_id: int, data: dict) -> PurchaseOrder:
    po = PurchaseOrder.objects.select_for_update().filter(pk=po_id).first()
    if po is None:
        raise DomainError("Purchase order not found.")
    if po.status not in ("draft", "ordered"):
        raise ConflictError("Only draft or open purchase orders can be edited.")
    if po.receipts.exists():
        raise ConflictError("This purchase order already has goods received and can no longer be edited.")
    _get_supplier(data["supplier_id"])
    _validate_po_lines(data["lines"])
    po.supplier_id, po.date, po.expected_date = data["supplier_id"], data["date"], data.get("expected_date")
    po.status, po.notes = data["status"], data.get("notes", "")
    po.save()
    po.lines.all().delete()
    POLine.objects.bulk_create([POLine(po=po, **l) for l in data["lines"]])
    audit(user, "update", "Purchase order", po.po_no, f"Updated purchase order {po.po_no}")
    return po


@transaction.atomic
def set_po_status(user, po_id: int, status: str) -> PurchaseOrder:
    po = PurchaseOrder.objects.select_for_update().filter(pk=po_id).first()
    if po is None:
        raise DomainError("Purchase order not found.")
    if status == "ordered" and po.status != "draft":
        raise ConflictError("Only draft orders can be marked as ordered.")
    if status == "cancelled" and po.status not in ("draft", "ordered"):
        raise ConflictError("Only orders with nothing received can be cancelled.")
    po.status = status
    po.save(update_fields=["status"])
    audit(user, "status", "Purchase order", po.po_no, f"Purchase order {po.po_no} marked {status}")
    return po


@transaction.atomic
def delete_po(user, po_id: int) -> None:
    po = PurchaseOrder.objects.filter(pk=po_id).first()
    if po is None:
        raise DomainError("Purchase order not found.")
    if po.receipts.exists():
        raise ConflictError("Cannot delete a purchase order that has goods receipts.")
    if po.status not in ("draft", "cancelled"):
        raise ConflictError("Only draft or cancelled purchase orders can be deleted.")
    no = po.po_no
    po.delete()
    audit(user, "delete", "Purchase order", no, f"Deleted purchase order {no}")


# ------------------------------ goods receipt ------------------------------


@transaction.atomic
def receive_goods(user, data: dict) -> GoodsReceipt:
    """Creates/reuses batches, posts 'receipt' movements, totals the receipt and updates the PO status."""
    po = PurchaseOrder.objects.select_for_update().filter(pk=data["po_id"]).first()
    if po is None:
        raise DomainError("Purchase order not found.")
    if po.status not in ("ordered", "partial"):
        raise ConflictError("Goods can only be received against an open purchase order.")
    if not data["lines"]:
        raise DomainError("Enter at least one received line.")

    pending = pending_by_product(po)
    po_lines = {l.product_id: l for l in po.lines.all()}
    on = data["date"]
    received_now: dict[int, int] = {}
    prepared = []  # (batch, line dict, rate, gst) — batches for new lots are written immediately inside this transaction

    for l in data["lines"]:
        pl = po_lines.get(l["product_id"])
        if pl is None:
            raise DomainError("Received product is not on the purchase order.")
        name = pl.product.name
        if l["qty"] <= 0:
            raise DomainError("Received quantity must be greater than zero.")
        batch_no = l["batch_no"].strip()
        if not batch_no:
            raise DomainError(f"Enter a batch number for {name}.")
        if l["expiry_date"] <= l["mfg_date"]:
            raise DomainError(f"Expiry date must be after the manufacturing date for {name}.")
        if l["expiry_date"] <= on:
            raise DomainError(f"{name} batch {batch_no} is already expired and cannot be received.")
        received_now[pl.product_id] = received_now.get(pl.product_id, 0) + l["qty"]
        if received_now[pl.product_id] > pending.get(pl.product_id, 0):
            raise DomainError(f"Received quantity for {name} exceeds the pending quantity ({pending.get(pl.product_id, 0)}).")

        batch = Batch.objects.select_for_update().filter(product_id=pl.product_id, batch_no=batch_no).first()
        if batch is not None:
            if batch.expiry_date != l["expiry_date"]:
                raise DomainError(f"Batch {batch_no} of {name} already exists with a different expiry date.")
            batch.received_qty += l["qty"]
            batch.save(update_fields=["received_qty"])
            is_new = False
        else:
            batch = Batch.objects.create(
                product_id=pl.product_id, batch_no=batch_no, mfg_date=l["mfg_date"], expiry_date=l["expiry_date"], received_qty=l["qty"],
                cost_price=pl.rate, supplier_id=po.supplier_id, received_on=on,
            )
            is_new = True
        prepared.append((batch, is_new, l, pl))

    taxable, tax, total = purchase_totals([(l["qty"], pl.rate, pl.gst_rate) for _b, _n, l, pl in prepared])
    grn = GoodsReceipt.objects.create(
        grn_no=next_doc_no("grn", on), po=po, supplier_id=po.supplier_id, date=on,
        supplier_invoice_no=data.get("supplier_invoice_no", ""), taxable=taxable, tax=tax, total=total,
    )
    for batch, is_new, l, pl in prepared:
        if is_new:
            batch.receipt = grn
            batch.save(update_fields=["receipt"])
        GRNLine.objects.create(
            receipt=grn, product_id=pl.product_id, batch=batch, batch_no=batch.batch_no, mfg_date=l["mfg_date"],
            expiry_date=l["expiry_date"], qty=l["qty"], rate=pl.rate, gst_rate=pl.gst_rate,
        )
        post_movement(
            user=user, date=on, batch=batch, type="receipt", bucket="saleable", qty=l["qty"],
            ref_type="Goods receipt", ref_id=grn.pk, ref_no=grn.grn_no,
        )
    po.status = "received" if all(v == 0 for v in pending_by_product(po).values()) else "partial"
    po.save(update_fields=["status"])
    audit(user, "create", "Goods receipt", grn.grn_no, f"Received goods against {po.po_no} ({len(prepared)} lines)")
    return grn


# ----------------------------- supplier returns -----------------------------


@transaction.atomic
def create_supplier_return(user, data: dict) -> SupplierReturn:
    supplier = _get_supplier(data["supplier_id"])
    if not data["lines"]:
        raise DomainError("Add at least one batch to return.")
    batches = {b.pk: b for b in Batch.objects.select_related("product").filter(pk__in=[l["batch_id"] for l in data["lines"]])}
    lock_batches(batches.keys())
    used: dict[tuple[int, str], int] = {}
    lines = []
    for l in data["lines"]:
        batch = batches.get(l["batch_id"])
        if batch is None:
            raise DomainError("Batch not found.")
        if batch.supplier_id != supplier.pk:
            raise DomainError(f"Batch {batch.batch_no} was not supplied by this supplier.")
        if l["qty"] <= 0:
            raise DomainError("Return quantity must be greater than zero.")
        key = (batch.pk, l["bucket"])
        used[key] = used.get(key, 0) + l["qty"]
        if used[key] > bucket_qty(batch.pk, l["bucket"]):
            raise DomainError(f"Return quantity for batch {batch.batch_no} exceeds the {l['bucket']} stock on hand.")
        lines.append((batch, l["bucket"], l["qty"]))

    taxable, tax, total = purchase_totals([(q, b.cost_price, b.product.gst_rate) for b, _bk, q in lines])
    ret = SupplierReturn.objects.create(
        return_no=next_doc_no("supplier_return", data["date"]), supplier=supplier, date=data["date"], reason=data.get("reason", ""),
        taxable=taxable, tax=tax, total=total,
    )
    for batch, bucket, qty in lines:
        SupplierReturnLine.objects.create(
            supplier_return=ret, batch=batch, product_id=batch.product_id, bucket=bucket, qty=qty, rate=batch.cost_price, gst_rate=batch.product.gst_rate
        )
        post_movement(
            user=user, date=ret.date, batch=batch, type="supplier_return", bucket=bucket, qty=-qty,
            ref_type="Supplier return", ref_id=ret.pk, ref_no=ret.return_no,
        )
    audit(user, "create", "Supplier return", ret.return_no, f"Returned goods to supplier ({len(lines)} lines)")
    return ret


# ----------------------------- supplier payments -----------------------------


@transaction.atomic
def create_supplier_payment(user, data: dict) -> SupplierPayment:
    supplier = _get_supplier(data["supplier_id"])
    if data["amount"] <= 0:
        raise DomainError("Amount must be greater than zero.")
    p = SupplierPayment.objects.create(
        payment_no=next_doc_no("supplier_payment", data["date"]), supplier=supplier, date=data["date"], amount=q2(data["amount"]),
        mode=data["mode"], reference=data.get("reference", ""), notes=data.get("notes", ""),
    )
    audit(user, "create", "Supplier payment", p.payment_no, f"Recorded payment to {supplier.name}")
    return p


def supplier_outstanding_rows() -> list[dict]:
    """Per supplier: purchases (receipts) - returns - payments."""
    purchases = dict(GoodsReceipt.objects.values_list("supplier_id").annotate(t=Sum("total")).values_list("supplier_id", "t"))
    returns = dict(SupplierReturn.objects.values_list("supplier_id").annotate(t=Sum("total")).values_list("supplier_id", "t"))
    paid = dict(SupplierPayment.objects.values_list("supplier_id").annotate(t=Sum("amount")).values_list("supplier_id", "t"))
    last = dict(SupplierPayment.objects.values_list("supplier_id").annotate(d=Max("date")).values_list("supplier_id", "d"))
    rows = []
    for s in Supplier.objects.order_by("name"):
        p, r, a = purchases.get(s.pk) or ZERO, returns.get(s.pk) or ZERO, paid.get(s.pk) or ZERO
        rows.append(
            {
                "supplier_id": s.pk, "supplier_name": s.name, "gstin": s.gstin, "purchases": q2(p), "returns": q2(r), "paid": q2(a),
                "outstanding": q2(p - r - a), "last_payment_date": last.get(s.pk),
            }
        )
    return rows
