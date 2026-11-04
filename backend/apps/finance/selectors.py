"""Receivables arithmetic. Invoice outstanding = total + linked debit notes - linked credit notes - allocated payments."""

from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import DecimalField, Max, OuterRef, Subquery, Sum, Value
from django.db.models.functions import Coalesce, TruncMonth
from django.utils import timezone

from apps.core.money import ZERO, q2
from apps.parties.models import Distributor
from apps.sales.models import Invoice, NoteDocument

from .models import Expense, ExpenseCategory, Payment, PaymentAllocation
from .ranges import month_keys_between

_DEC = DecimalField(max_digits=14, decimal_places=2)


def _total(sub_qs, field):
    return Coalesce(
        Subquery(sub_qs.order_by().values("invoice").annotate(t=Sum(field)).values("t")[:1], output_field=_DEC),
        Value(ZERO),
        output_field=_DEC,
    )


def annotate_invoice_financials(qs):
    """Adds `paid_amt`, `credited_amt`, `debited_amt` to an Invoice queryset (one query, no N+1)."""
    return qs.annotate(
        paid_amt=_total(PaymentAllocation.objects.filter(invoice=OuterRef("pk")), "amount"),
        credited_amt=_total(NoteDocument.objects.filter(invoice=OuterRef("pk"), type="credit"), "total"),
        debited_amt=_total(NoteDocument.objects.filter(invoice=OuterRef("pk"), type="debit"), "total"),
    )


def invoice_outstanding(total, paid, credited, debited):
    return max(ZERO, q2(total + debited - credited - paid))


def _pay_status(outstanding, paid, credited) -> str:
    if outstanding <= Decimal("0.005"):
        return "paid"
    return "partial" if paid + credited > 0 else "unpaid"


def _invoice_row(inv, today) -> dict:
    paid, credited, debited = q2(inv.paid_amt), q2(inv.credited_amt), q2(inv.debited_amt)
    outstanding = invoice_outstanding(inv.total, paid, credited, debited)
    overdue = outstanding > Decimal("0.005") and inv.due_date < today
    d = inv.distributor
    return {
        "id": inv.pk,
        "invoice_no": inv.invoice_no,
        "distributor_id": inv.distributor_id,
        "order_id": inv.order_id,
        "dispatch_id": inv.dispatch_id,
        "date": inv.date,
        "due_date": inv.due_date,
        "inter_state": inv.inter_state,
        "lines": [
            {
                "product_id": l.product_id,
                "batch_id": l.batch_id,
                "qty": l.qty,
                "rate": l.rate,
                "discount_pct": l.discount_pct,
                "gst_rate": l.gst_rate,
                "unit_cost": l.unit_cost,
                "taxable": l.taxable,
                "cgst": l.cgst,
                "sgst": l.sgst,
                "igst": l.igst,
            }
            for l in inv.lines.all()
        ],
        "taxable": inv.taxable,
        "cgst": inv.cgst,
        "sgst": inv.sgst,
        "igst": inv.igst,
        "round_off": inv.round_off,
        "total": inv.total,
        "distributor_name": d.name,
        "distributor_gstin": d.gstin,
        "distributor_state": d.state,
        "order_no": inv.order.order_no,
        "dispatch_no": inv.dispatch.dispatch_no,
        "paid": paid,
        "credited": credited,
        "debited": debited,
        "outstanding": outstanding,
        "pay_status": _pay_status(outstanding, paid, credited),
        "overdue": overdue,
        "days_overdue": (today - inv.due_date).days if overdue else 0,
    }


def invoice_rows(qs=None) -> list[dict]:
    """`InvoiceRow` dicts (frontend shape) for a queryset of invoices; constant number of queries."""
    qs = Invoice.objects.all() if qs is None else qs
    qs = annotate_invoice_financials(qs.select_related("distributor", "order", "dispatch").prefetch_related("lines"))
    today = timezone.localdate()
    return [_invoice_row(inv, today) for inv in qs]


def open_invoice_rows(distributor_id) -> list[dict]:
    rows = [r for r in invoice_rows(Invoice.objects.filter(distributor_id=distributor_id)) if r["outstanding"] > Decimal("0.005")]
    rows.sort(key=lambda r: (r["due_date"], r["date"]))
    return rows


def overdue_invoice_values() -> list[dict]:
    """(distributor_id, outstanding) of every overdue invoice with one query."""
    today = timezone.localdate()
    out = []
    qs = annotate_invoice_financials(Invoice.objects.filter(due_date__lt=today)).values(
        "id", "distributor_id", "total", "paid_amt", "credited_amt", "debited_amt"
    )
    for r in qs:
        o = invoice_outstanding(r["total"], r["paid_amt"], r["credited_amt"], r["debited_amt"])
        if o > Decimal("0.005"):
            out.append({"id": r["id"], "distributor_id": r["distributor_id"], "outstanding": o})
    return out


def payment_rows(qs=None) -> list[dict]:
    qs = Payment.objects.all() if qs is None else qs
    rows = []
    for p in qs.select_related("distributor").prefetch_related("allocations"):
        allocs = [{"invoice_id": a.invoice_id, "amount": a.amount} for a in p.allocations.all()]
        allocated = q2(sum((a["amount"] for a in allocs), ZERO))
        rows.append(
            {
                "id": p.pk,
                "receipt_no": p.receipt_no,
                "distributor_id": p.distributor_id,
                "date": p.date,
                "amount": p.amount,
                "mode": p.mode,
                "reference": p.reference,
                "notes": p.notes,
                "allocations": allocs,
                "distributor_name": p.distributor.name,
                "allocated": allocated,
                "unallocated": q2(p.amount - allocated),
            }
        )
    return rows


def _by_distributor(qs, field, **extra):
    return {r["distributor_id"]: r for r in qs.values("distributor_id").annotate(t=Sum(field), **extra)}


def distributor_balances() -> list[dict]:
    """`DistributorBalance` for every distributor, computed with a fixed number of aggregate queries."""
    today = timezone.localdate()
    invoiced = {k: v["t"] for k, v in _by_distributor(Invoice.objects.all(), "total").items()}
    notes: dict[tuple, Decimal] = {(r["distributor_id"], r["type"]): r["t"] for r in NoteDocument.objects.values("distributor_id", "type").annotate(t=Sum("total"))}
    pays = _by_distributor(Payment.objects.all(), "amount", last=Max("date"))
    allocated = {r["payment__distributor_id"]: r["t"] for r in PaymentAllocation.objects.values("payment__distributor_id").annotate(t=Sum("amount"))}
    overdue: dict[int, list[Decimal]] = defaultdict(list)
    for r in overdue_invoice_values():
        overdue[r["distributor_id"]].append(r["outstanding"])

    out = []
    for d in Distributor.objects.order_by("name"):
        inv = q2(invoiced.get(d.pk, ZERO))
        debit = q2(notes.get((d.pk, "debit"), ZERO))
        credit = q2(notes.get((d.pk, "credit"), ZERO))
        received = q2(pays.get(d.pk, {}).get("t", ZERO) or ZERO)
        balance = q2(inv + debit - credit - received)
        od = overdue.get(d.pk, [])
        used = (max(ZERO, balance) / d.credit_limit * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP) if d.credit_limit else Decimal(0)
        out.append(
            {
                "distributor_id": d.pk,
                "distributor_name": d.name,
                "code": d.code,
                "type": d.type,
                "credit_limit": d.credit_limit,
                "invoiced": inv,
                "debit_notes": debit,
                "credit_notes": credit,
                "received": received,
                "balance": balance,
                "unallocated": q2(received - q2(allocated.get(d.pk, ZERO))),
                "overdue_amount": q2(sum(od, ZERO)),
                "overdue_invoices": len(od),
                "credit_used_pct": int(used),
                "over_limit": d.credit_limit > 0 and balance > d.credit_limit,
                "last_payment_date": pays.get(d.pk, {}).get("last"),
            }
        )
    return out


def ledger_for(distributor_id) -> list[dict]:
    """Chronological ledger with a running balance (invoice < note < payment on the same day)."""
    raw = []
    for i in Invoice.objects.filter(distributor_id=distributor_id).only("id", "invoice_no", "date", "total"):
        raw.append((i.date, 0, i.invoice_no, {"type": "invoice", "ref": i.invoice_no, "ref_id": i.pk, "description": "Sales invoice", "debit": i.total, "credit": ZERO}))
    for n in NoteDocument.objects.filter(distributor_id=distributor_id).select_related("invoice"):
        label = "Credit" if n.type == "credit" else "Debit"
        against = f" against {n.invoice.invoice_no}" if n.invoice_id else ""
        raw.append(
            (
                n.date,
                1,
                n.note_no,
                {
                    "type": "credit_note" if n.type == "credit" else "debit_note",
                    "ref": n.note_no,
                    "ref_id": n.pk,
                    "description": f"{label} note{against} — {n.reason}",
                    "debit": n.total if n.type == "debit" else ZERO,
                    "credit": n.total if n.type == "credit" else ZERO,
                },
            )
        )
    for p in Payment.objects.filter(distributor_id=distributor_id):
        ref = f" — {p.reference}" if p.reference else ""
        raw.append((p.date, 2, p.receipt_no, {"type": "payment", "ref": p.receipt_no, "ref_id": p.pk, "description": f"Payment received ({p.mode.replace('_', ' ')}){ref}", "debit": ZERO, "credit": p.amount}))
    raw.sort(key=lambda r: (r[0], r[1], r[2]))
    balance = ZERO
    out = []
    for d, _order, _ref, e in raw:
        balance = q2(balance + e["debit"] - e["credit"])
        out.append({"date": d, **e, "balance": balance})
    return out


def suggest_allocations(amount, open_rows: list[dict]) -> list[dict]:
    """Oldest-due-first allocation of `amount` over open invoices."""
    left = q2(amount)
    out = []
    for r in open_rows:
        take = min(left, r["outstanding"])
        left = q2(left - take)
        out.append(
            {
                "invoice_id": r["id"],
                "invoice_no": r["invoice_no"],
                "date": r["date"],
                "due_date": r["due_date"],
                "outstanding": r["outstanding"],
                "suggested": take if take > 0 else ZERO,
            }
        )
    return out


def expense_rows(qs=None) -> list[dict]:
    qs = Expense.objects.all() if qs is None else qs
    return [
        {
            "id": e.pk,
            "expense_no": e.expense_no,
            "date": e.date,
            "category_id": e.category_id,
            "payee": e.payee,
            "description": e.description,
            "amount": e.amount,
            "mode": e.mode,
            "category_name": e.category.name,
        }
        for e in qs.select_related("category")
    ]


def income_expense_summary(frm, to) -> dict:
    """Operational income and expense view for a period (not a P&L, not double-entry)."""
    from apps.purchasing.models import GoodsReceipt, SupplierPayment, SupplierReturn

    def total(qs, field):
        return q2(qs.aggregate(t=Sum(field))["t"] or ZERO)

    rng = {"date__gte": frm, "date__lte": to}
    sales = total(Invoice.objects.filter(**rng), "taxable")
    credit_notes = total(NoteDocument.objects.filter(type="credit", **rng), "taxable")
    debit_notes = total(NoteDocument.objects.filter(type="debit", **rng), "taxable")
    purchases = total(GoodsReceipt.objects.filter(**rng), "taxable")
    sup_returns = total(SupplierReturn.objects.filter(**rng), "taxable")
    expenses = Expense.objects.filter(**rng)
    by_cat = {r["category_id"]: r["t"] for r in expenses.values("category_id").annotate(t=Sum("amount"))}
    categories = sorted(
        (
            {"category_id": c.pk, "category_name": c.name, "amount": q2(by_cat[c.pk])}
            for c in ExpenseCategory.objects.all()
            if by_cat.get(c.pk, ZERO) > 0
        ),
        key=lambda c: -c["amount"],
    )
    total_expenses = q2(sum((c["amount"] for c in categories), ZERO))
    net_income = q2(sales - credit_notes + debit_notes)
    net_purchases = q2(purchases - sup_returns)

    def by_month(model, field, **flt):
        return {
            month_key_: v
            for month_key_, v in (
                (f"{r['m'].year:04d}-{r['m'].month:02d}", r["t"])
                for r in model.objects.filter(**flt, **rng).annotate(m=TruncMonth("date")).values("m").annotate(t=Sum(field))
            )
        }

    inv_m = by_month(Invoice, "taxable")
    cn_m = by_month(NoteDocument, "taxable", type="credit")
    dn_m = by_month(NoteDocument, "taxable", type="debit")
    pur_m = by_month(GoodsReceipt, "taxable")
    ret_m = by_month(SupplierReturn, "taxable")
    exp_m = by_month(Expense, "amount")
    months = [
        {
            "month": m,
            "income": q2(inv_m.get(m, ZERO) - cn_m.get(m, ZERO) + dn_m.get(m, ZERO)),
            "purchases": q2(pur_m.get(m, ZERO) - ret_m.get(m, ZERO)),
            "expenses": q2(exp_m.get(m, ZERO)),
        }
        for m in month_keys_between(frm, to)
    ]
    return {
        "sales_taxable": sales,
        "credit_notes_taxable": credit_notes,
        "debit_notes_taxable": debit_notes,
        "net_income": net_income,
        "purchases_taxable": purchases,
        "supplier_returns_taxable": sup_returns,
        "net_purchases": net_purchases,
        "expenses_by_category": categories,
        "total_expenses": total_expenses,
        "operating_result": q2(net_income - net_purchases - total_expenses),
        "collections": total(Payment.objects.filter(**rng), "amount"),
        "supplier_payments": total(SupplierPayment.objects.filter(**rng), "amount"),
        "months": months,
    }


