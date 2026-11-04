"""Payment recording and allocation. Every function is atomic; invoices are row-locked while balances are checked."""

from decimal import Decimal

from django.db import transaction

from apps.core.audit import audit
from apps.core.exceptions import DomainError
from apps.core.money import ZERO, q2
from apps.core.numbering import next_doc_no
from apps.sales.models import Invoice

from .models import Payment, PaymentAllocation
from .selectors import invoice_rows

EPS = Decimal("0.005")


def _validate_allocations(distributor_id, allocations: list[dict], available: Decimal) -> list[tuple[int, Decimal]]:
    """Returns [(invoice_id, amount)] after checking ownership, duplicates, per-invoice balance and the total."""
    if not allocations:
        return []
    ids = [a["invoice_id"] for a in allocations]
    if len(set(ids)) != len(ids):
        raise DomainError("An invoice appears twice in the allocation.")
    # Lock the invoices so two concurrent payments cannot both consume the same outstanding balance (PostgreSQL).
    list(Invoice.objects.select_for_update().filter(pk__in=ids).order_by("pk").values_list("pk", flat=True))
    rows = {r["id"]: r for r in invoice_rows(Invoice.objects.filter(pk__in=ids))}
    total = ZERO
    out = []
    for a in allocations:
        amount = q2(a["amount"])
        if amount <= 0:
            raise DomainError("Allocated amount must be greater than zero.")
        row = rows.get(a["invoice_id"])
        if row is None or row["distributor_id"] != distributor_id:
            raise DomainError("Allocated invoice does not belong to this distributor.")
        if amount > row["outstanding"] + EPS:
            raise DomainError(f"Allocation to {row['invoice_no']} exceeds its outstanding amount ({row['outstanding']}).")
        total += amount
        out.append((a["invoice_id"], amount))
    if total > available + EPS:
        raise DomainError("Allocated total exceeds the payment amount available.")
    return out


@transaction.atomic
def create_payment(user, *, distributor, date, amount, mode, reference="", notes="", allocations=None) -> Payment:
    """Records money received. Allocations are optional; whatever is not allocated stays on account."""
    amount = q2(amount)
    if amount <= 0:
        raise DomainError("Amount must be greater than zero.")
    if not distributor.active:
        raise DomainError(f"{distributor.name} is inactive.")
    allocs = _validate_allocations(distributor.pk, allocations or [], amount)
    payment = Payment.objects.create(
        receipt_no=next_doc_no("receipt", date), distributor=distributor, date=date, amount=amount, mode=mode, reference=reference, notes=notes
    )
    PaymentAllocation.objects.bulk_create([PaymentAllocation(payment=payment, invoice_id=i, amount=a) for i, a in allocs])
    audit(user, "create", "Payment", payment.receipt_no, f"Recorded payment from {distributor.name}")
    return payment


@transaction.atomic
def allocate_payment(user, payment_id, allocations: list[dict]) -> Payment:
    """Allocates part of an existing payment's unallocated amount to more invoices."""
    payment = Payment.objects.select_for_update().select_related("distributor").get(pk=payment_id)
    already = q2(sum((a.amount for a in payment.allocations.all()), ZERO))
    allocs = _validate_allocations(payment.distributor_id, allocations, q2(payment.amount - already))
    if not allocs:
        raise DomainError("Enter at least one allocation.")
    for invoice_id, amount in allocs:
        existing = PaymentAllocation.objects.filter(payment=payment, invoice_id=invoice_id).first()
        if existing:
            existing.amount = q2(existing.amount + amount)
            existing.save(update_fields=["amount"])
        else:
            PaymentAllocation.objects.create(payment=payment, invoice_id=invoice_id, amount=amount)
    audit(user, "update", "Payment", payment.receipt_no, "Allocated payment to invoices")
    return payment
