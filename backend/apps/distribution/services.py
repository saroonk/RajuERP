"""
Distribution business logic: orders, dispatches (batch allocation + stock deduction) and distributor stock records.

Dispatched quantity is *not* distributor sales. Sales and remaining stock exist only where the distributor
reported them (`DistributorStockReport`), entered manually or imported.
"""

import re
from collections import defaultdict
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from apps.core.audit import audit
from apps.core.dates import reject_future_date
from apps.core.exceptions import ConflictError, DomainError
from apps.core.models import Settings
from apps.core.numbering import next_doc_no
from apps.core.tax import document_totals, is_inter_state, line_tax
from apps.inventory.stock import bucket_map, lock_batches, post_movement

from .models import DispatchLine, Dispatch, DistributionOrder, DistributorStockReport, OrderLine

PERIOD_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _fmt(n) -> str:
    return f"{n:,}"


# --------------------------------------------------------------------------- rows


def order_queryset():
    return DistributionOrder.objects.select_related("distributor").prefetch_related("lines", "dispatches__lines")


def order_row(order: DistributionOrder, home_state: str | None = None) -> dict:
    """`DistributionOrderRow`. Expects the queryset from `order_queryset()` to avoid N+1 queries."""
    home_state = home_state if home_state is not None else Settings.load().state
    lines = sorted(order.lines.all(), key=lambda l: l.pk)
    dispatches = list(order.dispatches.all())
    dispatched: dict[int, int] = defaultdict(int)
    for d in dispatches:
        for dl in d.lines.all():
            dispatched[dl.product_id] += dl.qty
    progress = [
        {"product_id": l.product_id, "ordered": l.qty, "dispatched": dispatched[l.product_id], "pending": max(0, l.qty - dispatched[l.product_id])}
        for l in lines
    ]
    ordered_total = sum(p["ordered"] for p in progress)
    done = sum(min(p["dispatched"], p["ordered"]) for p in progress)
    inter = is_inter_state(home_state, order.distributor.state)
    totals = document_totals([line_tax(l.qty, l.rate, l.discount_pct, l.gst_rate, inter) for l in lines], round_to_rupee=False)
    return {
        "id": order.pk,
        "order_no": order.order_no,
        "distributor_id": order.distributor_id,
        "date": order.date,
        "expected_date": order.expected_date,
        "status": order.status,
        "lines": [{"product_id": l.product_id, "qty": l.qty, "rate": l.rate, "discount_pct": l.discount_pct, "gst_rate": l.gst_rate} for l in lines],
        "notes": order.notes,
        "distributor_name": order.distributor.name,
        "taxable": totals.taxable,
        "tax": totals.tax,
        "total": totals.taxable + totals.tax,
        "line_progress": progress,
        "dispatched_pct": round(done * 100 / ordered_total) if ordered_total else 0,
        "has_dispatches": bool(dispatches),
    }


def dispatch_queryset():
    return Dispatch.objects.select_related("order", "distributor", "invoice").prefetch_related("lines")


def dispatch_row(d: Dispatch) -> dict:
    """`DispatchRow`. Expects `dispatch_queryset()`."""
    lines = sorted(d.lines.all(), key=lambda l: l.pk)
    invoice = getattr(d, "invoice", None)
    return {
        "id": d.pk,
        "dispatch_no": d.dispatch_no,
        "order_id": d.order_id,
        "distributor_id": d.distributor_id,
        "date": d.date,
        "vehicle_no": d.vehicle_no,
        "delivery_ref": d.delivery_ref,
        "lines": [{"product_id": l.product_id, "batch_id": l.batch_id, "qty": l.qty} for l in lines],
        "invoice_id": invoice.pk if invoice else None,
        "notes": d.notes,
        "order_no": d.order.order_no,
        "distributor_name": d.distributor.name,
        "invoice_no": invoice.invoice_no if invoice else None,
        "total_qty": sum(l.qty for l in lines),
    }


# --------------------------------------------------------------------------- orders


def _prepare_lines(lines: list[dict]) -> list[dict]:
    """Server-side line validation. GST is always taken from the product, never trusted from the client."""
    if not lines:
        raise DomainError("Add at least one product line.")
    seen = set()
    out = []
    for l in lines:
        product = l["product"]
        if product.pk in seen:
            raise DomainError(f"{product.name} appears twice; combine the quantities.")
        seen.add(product.pk)
        if l["qty"] <= 0:
            raise DomainError("Quantity must be greater than zero.")
        if l["rate"] <= 0:
            raise DomainError("Rate must be greater than zero.")
        if not (0 <= l["discount_pct"] <= 100):
            raise DomainError("Discount must be between 0 and 100%.")
        out.append({"product": product, "qty": l["qty"], "rate": l["rate"], "discount_pct": l["discount_pct"], "gst_rate": product.gst_rate})
    return out


def _replace_lines(order: DistributionOrder, lines: list[dict]) -> None:
    order.lines.all().delete()
    OrderLine.objects.bulk_create([OrderLine(order=order, **l) for l in lines])


@transaction.atomic
def create_order(user, data: dict) -> DistributionOrder:
    distributor = data["distributor"]
    if not distributor.active:
        raise DomainError(f"{distributor.name} is inactive.")
    reject_future_date(data["date"], "Order date")
    lines = _prepare_lines(data["lines"])
    order = DistributionOrder.objects.create(
        order_no=next_doc_no("order", data["date"]),
        distributor=distributor,
        date=data["date"],
        expected_date=data.get("expected_date"),
        status=data["status"],
        notes=data.get("notes", ""),
    )
    _replace_lines(order, lines)
    audit(user, "create", "Distribution order", order.order_no, f"Created order {order.order_no} for {distributor.name}")
    return order


@transaction.atomic
def update_order(user, order_id: int, data: dict) -> DistributionOrder:
    order = DistributionOrder.objects.select_for_update().get(pk=order_id)
    if order.dispatches.exists():
        raise DomainError("This order already has dispatches and can no longer be edited.")
    if order.status not in ("draft", "confirmed"):
        raise DomainError("Only draft or confirmed orders can be edited.")
    distributor = data["distributor"]
    if not distributor.active:
        raise DomainError(f"{distributor.name} is inactive.")
    reject_future_date(data["date"], "Order date")
    lines = _prepare_lines(data["lines"])
    order.distributor = distributor
    order.date = data["date"]
    order.expected_date = data.get("expected_date")
    order.status = data["status"]
    order.notes = data.get("notes", "")
    order.save()
    _replace_lines(order, lines)
    audit(user, "update", "Distribution order", order.order_no, f"Updated order {order.order_no}")
    return order


@transaction.atomic
def set_order_status(user, order_id: int, status: str) -> DistributionOrder:
    order = DistributionOrder.objects.select_for_update().get(pk=order_id)
    if status == "confirmed" and order.status != "draft":
        raise DomainError("Only draft orders can be confirmed.")
    if status == "cancelled" and order.status not in ("draft", "confirmed"):
        raise DomainError("Orders with dispatches cannot be cancelled.")
    order.status = status
    order.save(update_fields=["status"])
    audit(user, "status", "Distribution order", order.order_no, f"Order {order.order_no} {status}")
    return order


@transaction.atomic
def delete_order(user, order_id: int) -> None:
    order = DistributionOrder.objects.select_for_update().get(pk=order_id)
    if order.dispatches.exists():
        raise ConflictError("Cannot delete an order that has dispatches.")
    if order.status not in ("draft", "cancelled"):
        raise DomainError("Only draft or cancelled orders can be deleted.")
    ref = order.order_no
    order.delete()
    audit(user, "delete", "Distribution order", ref, f"Deleted order {ref}")


# --------------------------------------------------------------------------- dispatches


def _pending_by_product(order: DistributionOrder) -> dict[int, int]:
    dispatched = {
        r["product_id"]: r["t"]
        for r in DispatchLine.objects.filter(dispatch__order=order).values("product_id").annotate(t=Sum("qty"))
    }
    return {l.product_id: max(0, l.qty - dispatched.get(l.product_id, 0)) for l in order.lines.all()}


@transaction.atomic
def create_dispatch(user, data: dict) -> Dispatch:
    """Allocates batches, deducts stock through the ledger and updates the order status, all or nothing."""
    order = DistributionOrder.objects.select_for_update().select_related("distributor").get(pk=data["order"].pk)
    if order.status not in ("confirmed", "partially_dispatched"):
        raise DomainError("Only confirmed orders can be dispatched.")
    reject_future_date(data["date"], "Dispatch date")
    if data["date"] < order.date:
        raise DomainError("Dispatch date cannot be before the order date.")
    lines = data["lines"]
    if not lines:
        raise DomainError("Allocate at least one batch.")

    pending = _pending_by_product(order)
    lock_batches([l["batch"].pk for l in lines])
    buckets = bucket_map(l["batch"].pk for l in lines)
    per_product: dict[int, int] = defaultdict(int)
    per_batch: dict[int, int] = defaultdict(int)

    for l in lines:
        batch, product = l["batch"], l["product"]
        if l["qty"] <= 0:
            raise DomainError("Dispatch quantity must be greater than zero.")
        if batch.product_id != product.pk:
            raise DomainError("Batch does not belong to the selected product.")
        if product.pk not in pending:
            raise DomainError(f"{product.name} is not on this order.")
        if batch.expiry_date < data["date"]:
            raise DomainError(f"Batch {batch.batch_no} of {product.name} is expired on the dispatch date.")
        per_product[product.pk] += l["qty"]
        if per_product[product.pk] > pending[product.pk]:
            raise DomainError(f"Dispatch quantity for {product.name} exceeds the pending order quantity ({_fmt(pending[product.pk])}).")
        per_batch[batch.pk] += l["qty"]
        saleable = buckets[batch.pk]["saleable"] if batch.pk in buckets else 0
        if per_batch[batch.pk] > saleable:
            raise DomainError(f"Batch {batch.batch_no} of {product.name} has only {_fmt(saleable)} saleable units.")

    dispatch = Dispatch.objects.create(
        dispatch_no=next_doc_no("dispatch", data["date"]),
        order=order,
        distributor=order.distributor,
        date=data["date"],
        vehicle_no=data.get("vehicle_no", ""),
        delivery_ref=data.get("delivery_ref", ""),
        notes=data.get("notes", ""),
    )
    DispatchLine.objects.bulk_create([DispatchLine(dispatch=dispatch, product=l["product"], batch=l["batch"], qty=l["qty"]) for l in lines])
    for l in lines:
        post_movement(
            user=user, date=data["date"], batch=l["batch"], type="dispatch", bucket="saleable", qty=-l["qty"],
            ref_type="Dispatch", ref_id=dispatch.pk, ref_no=dispatch.dispatch_no,
        )
    remaining = _pending_by_product(order)
    order.status = "dispatched" if all(v == 0 for v in remaining.values()) else "partially_dispatched"
    order.save(update_fields=["status"])
    audit(user, "create", "Dispatch", dispatch.dispatch_no, f"Dispatched {len(lines)} batch lines for {order.order_no}")
    return dispatch


# --------------------------------------------------------------------------- distributor stock


def stock_rows() -> list[dict]:
    """`DistributorStockRow[]`: what we dispatched and took back vs. what the distributor *reported* selling and holding."""
    from apps.parties.models import Distributor
    from apps.catalog.models import Product
    from apps.sales.models import SalesReturnLine

    key = lambda d, p: (d, p)  # noqa: E731
    rows: dict[tuple[int, int], dict] = {}

    def ensure(d, p):
        return rows.setdefault(
            key(d, p),
            {
                "distributor_id": d, "product_id": p, "dispatched": 0, "returned_to_us": 0, "reported_sales": None,
                "reported_remaining": None, "last_period": None, "unreconciled": None,
            },
        )

    for r in DispatchLine.objects.values("dispatch__distributor_id", "product_id").annotate(t=Sum("qty")):
        ensure(r["dispatch__distributor_id"], r["product_id"])["dispatched"] += r["t"]
    for r in SalesReturnLine.objects.values("sales_return__distributor_id", "product_id").annotate(t=Sum("qty")):
        ensure(r["sales_return__distributor_id"], r["product_id"])["returned_to_us"] += r["t"]
    for rep in DistributorStockReport.objects.order_by("period", "id"):
        row = ensure(rep.distributor_id, rep.product_id)
        row["reported_sales"] = (row["reported_sales"] or 0) + rep.reported_sales
        row["reported_remaining"] = rep.remaining_stock  # ordered by period: the last assignment is the latest period
        row["last_period"] = rep.period
    dist = dict(Distributor.objects.values_list("pk", "name"))
    prods = {p.pk: p for p in Product.objects.only("name", "sku")}
    out = []
    for row in rows.values():
        if row["reported_sales"] is not None:
            row["unreconciled"] = row["dispatched"] - row["returned_to_us"] - row["reported_sales"] - (row["reported_remaining"] or 0)
        row["distributor_name"] = dist.get(row["distributor_id"], "")
        row["product_name"] = prods[row["product_id"]].name
        row["sku"] = prods[row["product_id"]].sku
        out.append(row)
    out.sort(key=lambda r: (r["distributor_name"], r["product_name"]))
    return out


def stock_report_row(r: DistributorStockReport) -> dict:
    return {
        "id": r.pk,
        "distributor_id": r.distributor_id,
        "product_id": r.product_id,
        "period": r.period,
        "reported_sales": r.reported_sales,
        "remaining_stock": r.remaining_stock,
        "returned": r.returned,
        "reported_on": r.reported_on,
        "source": r.source,
        "distributor_name": r.distributor.name,
        "product_name": r.product.name,
        "sku": r.product.sku,
    }


def _upsert_report(data: dict, source: str) -> tuple[DistributorStockReport, bool]:
    if not PERIOD_RE.match(data["period"]):
        raise DomainError("Period must be in YYYY-MM format.")
    for k in ("reported_sales", "remaining_stock", "returned"):
        if data[k] < 0:
            raise DomainError("Quantities cannot be negative.")
    report, created = DistributorStockReport.objects.update_or_create(
        distributor=data["distributor"],
        product=data["product"],
        period=data["period"],
        defaults={
            "reported_sales": data["reported_sales"],
            "remaining_stock": data["remaining_stock"],
            "returned": data["returned"],
            "reported_on": timezone.localdate(),
            "source": source,
        },
    )
    return report, created


@transaction.atomic
def add_stock_report(user, data: dict) -> tuple[DistributorStockReport, bool]:
    report, created = _upsert_report(data, "manual")
    audit(user, "create", "Distributor stock report", data["distributor"].name, f"Recorded reported sales for {data['product'].name} ({report.period})")
    return report, created


def _to_int(text: str, label: str) -> int:
    try:
        value = Decimal((text or "0").strip() or "0")
    except InvalidOperation:
        raise DomainError(f"{label} must be a number.")
    if value != value.to_integral_value():
        raise DomainError(f"{label} must be a whole number.")
    return int(value)


@transaction.atomic
def import_stock_reports(user, rows: list[list[str]]) -> dict:
    """CSV rows: distributorCode, sku, period (YYYY-MM), reportedSales, remainingStock, returned. Valid rows are kept, bad rows reported."""
    from apps.catalog.models import Product
    from apps.parties.models import Distributor

    result = {"imported": 0, "errors": []}
    has_header = bool(rows) and bool(re.search("distributor", rows[0][0] if rows[0] else "", re.I))
    body = rows[1:] if has_header else rows
    offset = 2 if has_header else 1
    for idx, cols in enumerate(body):
        row_no = idx + offset
        try:
            cols = [c.strip() for c in cols] + [""] * 6
            code, sku, period, sales, remaining, returned = cols[:6]
            dist = Distributor.objects.filter(code__iexact=code).first() or Distributor.objects.filter(name__iexact=code).first()
            if not dist:
                raise DomainError(f'Unknown distributor "{code}"')
            product = Product.objects.filter(sku__iexact=sku).first()
            if not product:
                raise DomainError(f'Unknown SKU "{sku}"')
            with transaction.atomic():
                _upsert_report(
                    {
                        "distributor": dist, "product": product, "period": period,
                        "reported_sales": _to_int(sales, "Reported sales"),
                        "remaining_stock": _to_int(remaining, "Remaining stock"),
                        "returned": _to_int(returned, "Returned"),
                    },
                    "import",
                )
            result["imported"] += 1
        except (DomainError, IntegrityError) as e:
            result["errors"].append({"row": row_no, "message": e.message if isinstance(e, DomainError) else "Invalid row"})
    if result["imported"]:
        audit(user, "create", "Distributor stock report", "Import", f"Imported {result['imported']} distributor stock report rows")
    return result


@transaction.atomic
def delete_stock_report(user, report_id: int) -> None:
    report = DistributorStockReport.objects.select_related("distributor", "product").get(pk=report_id)
    audit(user, "delete", "Distributor stock report", report.distributor.name, f"Deleted reported stock for {report.product.name} ({report.period})")
    report.delete()
