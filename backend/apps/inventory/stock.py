"""
Stock ledger primitives. Every stock change in the system goes through `post_movement`; quantities are
always derived by summing `StockMovement` rows per batch and bucket, so stock and history cannot drift apart.
"""

from collections import defaultdict

from django.db.models import Sum

from apps.core.exceptions import DomainError

from .models import Batch, StockMovement

BUCKET_NAMES = ("saleable", "damaged", "expired", "inspection")


def empty_buckets() -> dict[str, int]:
    return {b: 0 for b in BUCKET_NAMES}


def bucket_map(batch_ids=None) -> dict[int, dict[str, int]]:
    """{batch_id: {bucket: qty}} summed from the movement ledger (one query)."""
    qs = StockMovement.objects.all()
    if batch_ids is not None:
        qs = qs.filter(batch_id__in=list(batch_ids))
    out: dict[int, dict[str, int]] = defaultdict(empty_buckets)
    for row in qs.values("batch_id", "bucket").annotate(total=Sum("qty")):
        out[row["batch_id"]][row["bucket"]] = row["total"] or 0
    return out


def bucket_qty(batch_id: int, bucket: str) -> int:
    return StockMovement.objects.filter(batch_id=batch_id, bucket=bucket).aggregate(t=Sum("qty"))["t"] or 0


def lock_batches(batch_ids) -> None:
    """
    Row-lock batches before checking and changing their stock. Effective on PostgreSQL (SELECT ... FOR UPDATE);
    SQLite ignores it and serialises writers instead, so concurrent-stock protection must be re-verified on PostgreSQL.
    """
    list(Batch.objects.select_for_update().filter(pk__in=list(batch_ids)).order_by("pk").values_list("pk", flat=True))


def post_movement(*, user, date, batch, type, bucket, qty, ref_type, ref_id, ref_no, note="") -> StockMovement:
    """Append one signed movement. Rejects a deduction that would take the bucket below zero."""
    if qty == 0:
        raise DomainError("A stock movement quantity cannot be zero.")
    if qty < 0 and bucket_qty(batch.pk, bucket) + qty < 0:
        raise DomainError(f"Batch {batch.batch_no} has only {bucket_qty(batch.pk, bucket)} {bucket} units; cannot remove {-qty}.")
    return StockMovement.objects.create(
        date=date,
        product_id=batch.product_id,
        batch=batch,
        type=type,
        bucket=bucket,
        qty=qty,
        ref_type=ref_type,
        ref_id=ref_id,
        ref_no=ref_no,
        note=note,
        created_by=getattr(user, "name", "") or "System",
    )


def dispatchable_on(product_id: int, on_date) -> list[tuple[Batch, int]]:
    """Batches with saleable stock that are not expired on `on_date`, earliest expiry first (FEFO)."""
    batches = list(
        Batch.objects.filter(product_id=product_id, expiry_date__gte=on_date, received_on__lte=on_date).order_by("expiry_date", "id")
    )
    buckets = bucket_map(b.pk for b in batches)
    return [(b, buckets[b.pk]["saleable"]) for b in batches if b.pk in buckets and buckets[b.pk]["saleable"] > 0]
