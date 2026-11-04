"""Inventory business operations: write-offs, stock-count reconciliation, allocation suggestions, valuation and alerts."""


from django.db import transaction

from apps.catalog.models import Product
from apps.core.audit import audit
from apps.core.exceptions import ConflictError, DomainError
from apps.core.money import ZERO, q2
from apps.core.numbering import next_doc_no

from .models import Batch, Reconciliation, ReconciliationLine, WriteOff, WriteOffLine
from .selectors import batch_stock_rows, product_stock_rows, today
from .stock import bucket_map, bucket_qty, dispatchable_on, lock_batches, post_movement
from .valuation import CostLayer, value_stock


def _batches(ids) -> dict[int, Batch]:
    found = {b.pk: b for b in Batch.objects.select_related("product").filter(pk__in=set(ids))}
    missing = set(ids) - set(found)
    if missing:
        raise DomainError("Batch not found.")
    return found


# ------------------------------- write-offs -------------------------------


@transaction.atomic
def create_write_off(user, data: dict) -> WriteOff:
    lines = data["lines"]
    if not lines:
        raise DomainError("Select at least one batch to write off.")
    reason = data["reason"].strip()
    if not reason:
        raise DomainError("Enter a reason for the write-off.")
    batches = _batches([l["batch_id"] for l in lines])
    lock_batches(batches.keys())

    used: dict[tuple[int, str], int] = {}
    built = []
    for l in lines:
        batch = batches[l["batch_id"]]
        if l["qty"] <= 0:
            raise DomainError("Write-off quantity must be greater than zero.")
        key = (batch.pk, l["bucket"])
        used[key] = used.get(key, 0) + l["qty"]
        if used[key] > bucket_qty(batch.pk, l["bucket"]):
            raise DomainError(f"Write-off for batch {batch.batch_no} exceeds the {l['bucket']} stock on hand.")
        built.append((batch, l["bucket"], l["qty"]))

    total = q2(sum((qty * b.cost_price for b, _bucket, qty in built), ZERO))
    wo = WriteOff.objects.create(
        write_off_no=next_doc_no("write_off", data["date"]), date=data["date"], reason=reason, total_value=total,
        created_by=user if getattr(user, "pk", None) else None,
    )
    for batch, bucket, qty in built:
        WriteOffLine.objects.create(write_off=wo, batch=batch, product_id=batch.product_id, bucket=bucket, qty=qty, unit_cost=batch.cost_price)
        post_movement(
            user=user, date=wo.date, batch=batch, type="write_off", bucket=bucket, qty=-qty,
            ref_type="Write-off", ref_id=wo.pk, ref_no=wo.write_off_no, note=reason,
        )
    audit(user, "create", "Write-off", wo.write_off_no, f"Wrote off stock worth Rs {total}")
    return wo


# ----------------------------- reconciliation -----------------------------


@transaction.atomic
def create_reconciliation(user, data: dict) -> Reconciliation:
    lines = data["lines"]
    if not lines:
        raise DomainError("Count at least one batch.")
    batches = _batches([l["batch_id"] for l in lines])
    buckets = bucket_map(batches.keys())
    seen: set[int] = set()
    rec = Reconciliation.objects.create(ref_no=next_doc_no("reconciliation", data["date"]), date=data["date"], notes=data.get("notes", ""))
    for l in lines:
        batch = batches[l["batch_id"]]
        if batch.pk in seen:
            raise DomainError(f"Batch {batch.batch_no} is counted twice.")
        seen.add(batch.pk)
        if l["physical_qty"] < 0:
            raise DomainError("Physical count cannot be negative.")
        system = buckets[batch.pk]["saleable"] if batch.pk in buckets else 0
        ReconciliationLine.objects.create(reconciliation=rec, batch=batch, product_id=batch.product_id, system_qty=system, physical_qty=l["physical_qty"])
    audit(user, "create", "Stock reconciliation", rec.ref_no, f"Recorded physical count for {len(lines)} batches")
    return rec


@transaction.atomic
def approve_reconciliation(user, rec_id: int) -> Reconciliation:
    rec = Reconciliation.objects.select_for_update().filter(pk=rec_id).first()
    if rec is None:
        raise DomainError("Reconciliation not found.")
    if rec.status != "draft":
        raise DomainError("This reconciliation is already approved.")
    lines = list(rec.lines.select_related("batch"))
    lock_batches([l.batch_id for l in lines])
    on = max(today(), rec.date)
    for line in lines:
        diff = line.physical_qty - bucket_qty(line.batch_id, "saleable")  # against stock at approval time
        line.applied_diff = diff
        line.save(update_fields=["applied_diff"])
        if diff != 0:
            post_movement(
                user=user, date=on, batch=line.batch, type="adjustment", bucket="saleable", qty=diff,
                ref_type="Stock reconciliation", ref_id=rec.pk, ref_no=rec.ref_no, note="Physical count adjustment",
            )
    rec.status = "approved"
    rec.approved_by = getattr(user, "name", "")
    rec.approved_on = on
    rec.save()
    audit(user, "status", "Stock reconciliation", rec.ref_no, "Approved reconciliation and posted stock adjustments")
    return rec


@transaction.atomic
def delete_reconciliation(user, rec_id: int) -> None:
    rec = Reconciliation.objects.filter(pk=rec_id).first()
    if rec is None:
        raise DomainError("Reconciliation not found.")
    if rec.status == "approved":
        raise ConflictError("Approved reconciliations cannot be deleted.")
    ref = rec.ref_no
    rec.delete()
    audit(user, "delete", "Stock reconciliation", ref, f"Deleted draft reconciliation {ref}")


# ------------------------------- allocation -------------------------------


def suggest_allocation(product_id: int, qty: int, on_date, exclude: dict[int, int] | None = None) -> list[dict]:
    """Earliest-expiry-first suggestion; `exclude` holds quantities already allocated elsewhere in the same form."""
    exclude = exclude or {}
    need = qty
    out = []
    for batch, avail in dispatchable_on(product_id, on_date):
        if need <= 0:
            break
        free = avail - exclude.get(batch.pk, 0)
        if free <= 0:
            continue
        take = min(free, need)
        out.append({"batch_id": batch.pk, "batch_no": batch.batch_no, "expiry_date": batch.expiry_date, "qty": take})
        need -= take
    return out


def dispatchable_batch_rows(product_id: int, on_date) -> list[dict]:
    ids = {b.pk for b, _q in dispatchable_on(product_id, on_date)}
    return sorted((r for r in batch_stock_rows(product_id=product_id) if r["id"] in ids), key=lambda r: (r["expiry_date"], r["id"]))


# -------------------------------- valuation --------------------------------


def valuation_rows(method: str) -> list[dict]:
    rows = batch_stock_rows()
    by_product: dict[int, list[dict]] = {}
    for r in rows:
        by_product.setdefault(r["product_id"], []).append(r)
    out = []
    for p in Product.objects.select_related("brand").order_by("name"):
        mine = by_product.get(p.pk, [])
        qty = sum(r["saleable"] for r in mine)
        layers = [CostLayer(r["received_qty"], r["cost_price"], r["received_on"]) for r in mine]
        unit_cost, value = value_stock(method, qty, layers)
        held = sum(((r["damaged"] + r["expired"] + r["inspection"]) * r["cost_price"] for r in mine), ZERO)
        out.append(
            {
                "product_id": p.pk, "sku": p.sku, "name": p.name, "brand_name": p.brand.name,
                "qty": qty, "unit_cost": unit_cost, "value": value, "held_value": q2(held),
            }
        )
    return out


# --------------------------------- alerts ---------------------------------


def alerts_summary() -> dict:
    batches = batch_stock_rows()
    expired = [b for b in batches if b["expiry_status"] == "expired" and b["saleable"] + b["expired"] > 0]
    expiring = sorted(
        (b for b in batches if b["expiry_status"] in ("critical", "warning") and b["saleable"] > 0), key=lambda b: b["days_to_expiry"]
    )
    active = set(Product.objects.filter(active=True).values_list("pk", flat=True))
    low_stock = [p for p in product_stock_rows(batches) if p["stock_status"] != "ok" and p["product_id"] in active]
    overdue, over_limit, pending = _receivable_alerts()
    return {
        "expiring": expiring,
        "expired": expired,
        "low_stock": low_stock,
        "overdue": overdue,
        "over_limit": over_limit,
        "pending_inspection": pending,
        "total": len(expiring) + len(expired) + len(low_stock) + len(overdue) + len(over_limit) + pending,
    }


def _receivable_alerts() -> tuple[list, list, int]:
    """Overdue invoices / over-limit distributors / returns pending inspection come from sales + finance (optional)."""
    overdue: list = []
    over_limit: list = []
    pending = 0
    try:
        from apps.sales.models import SalesReturnLine

        pending = SalesReturnLine.objects.filter(classification="inspection").count()
    except Exception:  # sales app not ready
        pass
    try:
        from apps.finance.selectors import distributor_balances, invoice_rows

        overdue = sorted((r for r in invoice_rows() if r["overdue"]), key=lambda r: -r["days_overdue"])
        over_limit = [b for b in distributor_balances() if b["over_limit"]]
    except ImportError:  # finance app not available
        pass
    return overdue, over_limit, pending


