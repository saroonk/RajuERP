"""Read-only stock views shared by the inventory API, dashboard, alerts and reports."""

from datetime import date as date_cls

from django.utils import timezone

from apps.catalog.models import Product
from apps.core.models import Settings
from apps.core.money import ZERO, q2

from .models import Batch
from .stock import bucket_map, empty_buckets


def today() -> date_cls:
    return timezone.localdate()


def expiry_status(expiry_date, on_date=None, alert_days: int | None = None) -> tuple[int, str]:
    on_date = on_date or today()
    alert_days = Settings.load().expiry_alert_days if alert_days is None else alert_days
    days = (expiry_date - on_date).days
    if days < 0:
        return days, "expired"
    if days <= 30:
        return days, "critical"
    if days <= alert_days:
        return days, "warning"
    return days, "ok"


def batch_stock_rows(product_id=None, batch_id=None) -> list[dict]:
    """One dict per batch with stock per bucket and expiry state (frontend `BatchStock`)."""
    qs = Batch.objects.select_related("product", "product__brand")
    if product_id:
        qs = qs.filter(product_id=product_id)
    if batch_id:
        qs = qs.filter(pk=batch_id)
    batches = list(qs.order_by("expiry_date", "id"))
    buckets = bucket_map(b.pk for b in batches)
    alert_days = Settings.load().expiry_alert_days
    rows = []
    for b in batches:
        q = buckets.get(b.pk) or empty_buckets()
        days, status = expiry_status(b.expiry_date, alert_days=alert_days)
        rows.append(
            {
                "id": b.pk,
                "product_id": b.product_id,
                "batch_no": b.batch_no,
                "mfg_date": b.mfg_date,
                "expiry_date": b.expiry_date,
                "received_qty": b.received_qty,
                "cost_price": b.cost_price,
                "supplier_id": b.supplier_id,
                "receipt_id": b.receipt_id,
                "received_on": b.received_on,
                "product_name": b.product.name,
                "sku": b.product.sku,
                "brand_id": b.product.brand_id,
                "brand_name": b.product.brand.name,
                "saleable": q["saleable"],
                "damaged": q["damaged"],
                "expired": q["expired"],
                "inspection": q["inspection"],
                "on_hand": sum(q.values()),
                "available": 0 if days < 0 else q["saleable"],
                "days_to_expiry": days,
                "expiry_status": status,
            }
        )
    return rows


def product_stock_rows(batch_rows: list[dict] | None = None) -> list[dict]:
    """One dict per product with sellable / expired / damaged / inspection stock (frontend `ProductStock`)."""
    rows = batch_rows if batch_rows is not None else batch_stock_rows()
    by_product: dict[int, list[dict]] = {}
    for r in rows:
        by_product.setdefault(r["product_id"], []).append(r)
    out = []
    for p in Product.objects.select_related("brand", "category", "unit").order_by("name"):
        mine = by_product.get(p.pk, [])
        available = sum(r["available"] for r in mine)
        out.append(
            {
                "product_id": p.pk,
                "sku": p.sku,
                "name": p.name,
                "brand_id": p.brand_id,
                "brand_name": p.brand.name,
                "category_id": p.category_id,
                "category_name": p.category.name,
                "unit_code": p.unit.code,
                "pack_size": p.pack_size,
                "min_stock": p.min_stock,
                "available": available,
                "expired": sum((r["saleable"] if r["expiry_status"] == "expired" else 0) + r["expired"] for r in mine),
                "damaged": sum(r["damaged"] for r in mine),
                "inspection": sum(r["inspection"] for r in mine),
                "batches": sum(1 for r in mine if r["on_hand"] > 0),
                "stock_status": "out" if available <= 0 else ("low" if available < p.min_stock else "ok"),
                "value": q2(sum((r["available"] * r["cost_price"] for r in mine), ZERO)),
            }
        )
    return out
