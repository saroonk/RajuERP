"""
Sales business logic: GST invoices created from dispatches, credit/debit notes and sales returns.

Totals and taxes are always computed here from the stored lines; request bodies never carry them.
"""

from collections import defaultdict
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from apps.core.audit import audit
from apps.core.dates import reject_future_date
from apps.core.exceptions import ConflictError, DomainError
from apps.core.models import Settings
from apps.core.money import ZERO, q2
from apps.core.numbering import next_doc_no
from apps.core.tax import document_totals, is_inter_state, line_tax
from apps.finance.selectors import annotate_invoice_financials, invoice_outstanding
from apps.inventory.stock import lock_batches, post_movement

from .models import Invoice, InvoiceLine, NoteDocument, SalesReturn, SalesReturnLine


def _fmt(n) -> str:
    return f"{n:,}"


# --------------------------------------------------------------------------- invoices


def invoice_queryset():
    """Invoices with paid/credited/debited annotated in the same query (no N+1)."""
    return annotate_invoice_financials(Invoice.objects.select_related("distributor", "order", "dispatch").prefetch_related("lines"))


def invoice_row(inv: Invoice, today=None) -> dict:
    """`InvoiceRow`. Expects `invoice_queryset()` annotations."""
    today = today or timezone.localdate()
    paid, credited, debited = q2(inv.paid_amt), q2(inv.credited_amt), q2(inv.debited_amt)
    outstanding = invoice_outstanding(inv.total, paid, credited, debited)
    overdue = outstanding > ZERO and inv.due_date < today
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
                "product_id": l.product_id, "batch_id": l.batch_id, "qty": l.qty, "rate": l.rate, "discount_pct": l.discount_pct,
                "gst_rate": l.gst_rate, "unit_cost": l.unit_cost, "taxable": l.taxable, "cgst": l.cgst, "sgst": l.sgst, "igst": l.igst,
            }
            for l in sorted(inv.lines.all(), key=lambda x: x.pk)
        ],
        "taxable": inv.taxable,
        "cgst": inv.cgst,
        "sgst": inv.sgst,
        "igst": inv.igst,
        "round_off": inv.round_off,
        "total": inv.total,
        "distributor_name": inv.distributor.name,
        "distributor_gstin": inv.distributor.gstin,
        "distributor_state": inv.distributor.state,
        "order_no": inv.order.order_no,
        "dispatch_no": inv.dispatch.dispatch_no,
        "paid": paid,
        "credited": credited,
        "debited": debited,
        "outstanding": outstanding,
        "pay_status": "paid" if outstanding <= ZERO else ("partial" if paid + credited > ZERO else "unpaid"),
        "overdue": overdue,
        "days_overdue": (today - inv.due_date).days if overdue else 0,
    }


@transaction.atomic
def create_invoice_from_dispatch(user, dispatch_id: int, date) -> Invoice:
    from apps.distribution.models import Dispatch

    try:
        dispatch = Dispatch.objects.select_for_update().select_related("order", "distributor").get(pk=dispatch_id)
    except Dispatch.DoesNotExist:
        raise DomainError("Dispatch not found.")
    if Invoice.objects.filter(dispatch=dispatch).exists():
        raise ConflictError("This dispatch has already been invoiced.")
    reject_future_date(date, "Invoice date")
    if date < dispatch.date:
        raise DomainError("Invoice date cannot be before the dispatch date.")

    dist = dispatch.distributor
    inter = is_inter_state(Settings.load().state, dist.state)
    order_lines = {l.product_id: l for l in dispatch.order.lines.all()}
    dispatch_lines = list(dispatch.lines.select_related("batch").order_by("pk"))
    if not dispatch_lines:
        raise DomainError("This dispatch has no lines to invoice.")

    computed = []
    for dl in dispatch_lines:
        ol = order_lines.get(dl.product_id)
        if ol is None:
            raise DomainError("Dispatched product is not on the order.")
        # Price, discount and GST come from the order (set on the server); unit cost is the batch cost snapshot.
        computed.append((dl, ol, line_tax(dl.qty, ol.rate, ol.discount_pct, ol.gst_rate, inter)))
    totals = document_totals([c[2] for c in computed])

    try:
        with transaction.atomic():
            inv = Invoice.objects.create(
                invoice_no=next_doc_no("invoice", date),
                distributor=dist,
                order=dispatch.order,
                dispatch=dispatch,
                date=date,
                due_date=date + timedelta(days=dist.credit_days),
                inter_state=inter,
                taxable=totals.taxable,
                cgst=totals.cgst,
                sgst=totals.sgst,
                igst=totals.igst,
                round_off=totals.round_off,
                total=totals.total,
            )
    except IntegrityError:
        raise ConflictError("This dispatch has already been invoiced.")
    InvoiceLine.objects.bulk_create(
        [
            InvoiceLine(
                invoice=inv, product_id=dl.product_id, batch=dl.batch, qty=dl.qty, rate=ol.rate, discount_pct=ol.discount_pct,
                gst_rate=ol.gst_rate, unit_cost=dl.batch.cost_price, taxable=t.taxable, cgst=t.cgst, sgst=t.sgst, igst=t.igst,
            )
            for dl, ol, t in computed
        ]
    )
    audit(user, "create", "Invoice", inv.invoice_no, f"Generated invoice for {dist.name}")
    return inv


# --------------------------------------------------------------------------- notes


def note_queryset():
    return NoteDocument.objects.select_related("distributor", "invoice", "sales_return")


def note_row(n: NoteDocument) -> dict:
    return {
        "id": n.pk,
        "note_no": n.note_no,
        "type": n.type,
        "distributor_id": n.distributor_id,
        "invoice_id": n.invoice_id,
        "return_id": n.sales_return_id,
        "date": n.date,
        "reason": n.reason,
        "taxable": n.taxable,
        "cgst": n.cgst,
        "sgst": n.sgst,
        "igst": n.igst,
        "round_off": n.round_off,
        "total": n.total,
        "distributor_name": n.distributor.name,
        "invoice_no": n.invoice.invoice_no if n.invoice else None,
        "return_no": n.sales_return.return_no if n.sales_return else None,
    }


def _make_note(user, *, type, distributor, invoice, sales_return, date, reason, taxable, cgst, sgst, igst, round_off=ZERO) -> NoteDocument:
    note = NoteDocument.objects.create(
        note_no=next_doc_no("credit_note" if type == "credit" else "debit_note", date),
        type=type,
        distributor=distributor,
        invoice=invoice,
        sales_return=sales_return,
        date=date,
        reason=reason,
        taxable=taxable,
        cgst=cgst,
        sgst=sgst,
        igst=igst,
        round_off=round_off,
        total=taxable + cgst + sgst + igst + round_off,
    )
    label = "Credit" if type == "credit" else "Debit"
    audit(user, "create", f"{label} note", note.note_no, f"{label} note for {distributor.name}")
    return note


@transaction.atomic
def create_note(user, data: dict) -> NoteDocument:
    distributor = data["distributor"]
    invoice = data.get("invoice")
    reject_future_date(data["date"], "Note date")
    if data["taxable"] <= 0:
        raise DomainError("Amount must be greater than zero.")
    if not data["reason"].strip():
        raise DomainError("Enter a reason for the note.")
    if invoice and invoice.distributor_id != distributor.pk:
        raise DomainError("Invoice belongs to a different distributor.")
    inter = invoice.inter_state if invoice else is_inter_state(Settings.load().state, distributor.state)
    t = line_tax(1, data["taxable"], 0, data["gst_rate"], inter)
    return _make_note(
        user, type=data["type"], distributor=distributor, invoice=invoice, sales_return=None, date=data["date"],
        reason=data["reason"].strip(), taxable=t.taxable, cgst=t.cgst, sgst=t.sgst, igst=t.igst,
    )


# --------------------------------------------------------------------------- sales returns


def return_queryset():
    return SalesReturn.objects.select_related("distributor", "invoice", "credit_note").prefetch_related("lines")


def return_row(r: SalesReturn) -> dict:
    lines = sorted(r.lines.all(), key=lambda l: l.pk)
    credit_note = getattr(r, "credit_note", None)
    return {
        "id": r.pk,
        "return_no": r.return_no,
        "distributor_id": r.distributor_id,
        "invoice_id": r.invoice_id,
        "date": r.date,
        "reason": r.reason,
        "notes": r.notes,
        "lines": [
            {
                "product_id": l.product_id, "batch_id": l.batch_id, "qty": l.qty, "rate": l.rate, "discount_pct": l.discount_pct,
                "gst_rate": l.gst_rate, "unit_cost": l.unit_cost, "classification": l.classification, "disposition_note": l.disposition_note,
            }
            for l in lines
        ],
        "credit_note_id": credit_note.pk if credit_note else None,
        "distributor_name": r.distributor.name,
        "invoice_no": r.invoice.invoice_no,
        "total_qty": sum(l.qty for l in lines),
        "value": q2(sum((l.qty * l.rate * (1 - l.discount_pct / 100) for l in lines), ZERO)),
        "credit_note_no": credit_note.note_no if credit_note else None,
        "status": "pending_inspection" if any(l.classification == "inspection" for l in lines) else "reconciled",
    }


def returnable_lines(invoice_id: int) -> list[dict]:
    """Per invoice line (product + batch): invoiced, already returned and still returnable quantity."""
    try:
        inv = Invoice.objects.prefetch_related("lines__batch").get(pk=invoice_id)
    except Invoice.DoesNotExist:
        raise DomainError("Invoice not found.")
    returned: dict[tuple[int, int], int] = defaultdict(int)
    for l in SalesReturnLine.objects.filter(sales_return__invoice=inv):
        returned[(l.product_id, l.batch_id)] += l.qty
    return [
        {
            "product_id": l.product_id,
            "batch_id": l.batch_id,
            "batch_no": l.batch.batch_no,
            "invoiced": l.qty,
            "returned": returned[(l.product_id, l.batch_id)],
            "remaining": l.qty - returned[(l.product_id, l.batch_id)],
        }
        for l in sorted(inv.lines.all(), key=lambda x: x.pk)
    ]


@transaction.atomic
def create_sales_return(user, data: dict) -> SalesReturn:
    inv = Invoice.objects.select_for_update().select_related("distributor").get(pk=data["invoice"].pk)
    reject_future_date(data["date"], "Return date")
    if data["date"] < inv.date:
        raise DomainError("Return date cannot be before the invoice date.")
    if not data["lines"]:
        raise DomainError("Select at least one line to return.")

    inv_lines = {(l.product_id, l.batch_id): l for l in inv.lines.all()}
    remaining = {(r["product_id"], r["batch_id"]): r["remaining"] for r in returnable_lines(inv.pk)}
    taken: dict[tuple[int, int], int] = defaultdict(int)
    prepared = []
    for l in data["lines"]:
        key = (l["product"].pk, l["batch"].pk)
        inv_line = inv_lines.get(key)
        if inv_line is None:
            raise DomainError("Returned item is not on the invoice.")
        if l["qty"] <= 0:
            raise DomainError("Return quantity must be greater than zero.")
        taken[key] += l["qty"]
        if taken[key] > remaining[key]:
            raise DomainError(
                f"Return quantity for {l['product'].name} exceeds the quantity still returnable ({_fmt(remaining[key])})."
            )
        prepared.append((l, inv_line))

    ret = SalesReturn.objects.create(
        return_no=next_doc_no("sales_return", data["date"]),
        distributor=inv.distributor,
        invoice=inv,
        date=data["date"],
        reason=data["reason"],
        notes=data.get("notes", ""),
    )
    lines = SalesReturnLine.objects.bulk_create(
        [
            SalesReturnLine(
                sales_return=ret, product=l["product"], batch=l["batch"], qty=l["qty"], rate=il.rate, discount_pct=il.discount_pct,
                gst_rate=il.gst_rate, unit_cost=il.unit_cost, classification=l["classification"],
                disposition_note="Awaiting inspection" if l["classification"] == "inspection" else "",
            )
            for l, il in prepared
        ]
    )
    lock_batches([l.batch_id for l in lines])
    # Each classification is its own stock bucket, so only 'saleable' goods rejoin sellable inventory.
    for l in lines:
        post_movement(
            user=user, date=data["date"], batch=l.batch, type="sales_return", bucket=l.classification, qty=l.qty,
            ref_type="Sales return", ref_id=ret.pk, ref_no=ret.return_no,
        )
    if data.get("issue_credit_note"):
        parts = [line_tax(l.qty, l.rate, l.discount_pct, l.gst_rate, inv.inter_state) for l in lines]
        t = document_totals(parts, round_to_rupee=False)
        # The invoice total was rounded to the rupee but the goods are credited at their exact value. When this return
        # completes the invoice, carry the invoice's round-off so the credits equal the invoice total (no leftover paise).
        round_off = ZERO
        if all(r["remaining"] == 0 for r in returnable_lines(inv.pk)):
            earlier = NoteDocument.objects.filter(invoice=inv, type="credit", sales_return__isnull=False).aggregate(s=Sum("total"))["s"] or ZERO
            gap = inv.total - earlier - t.total
            if abs(gap) < 1:
                round_off = gap
        _make_note(
            user, type="credit", distributor=inv.distributor, invoice=inv, sales_return=ret, date=data["date"],
            reason=f"Sales return {ret.return_no}", taxable=t.taxable, cgst=t.cgst, sgst=t.sgst, igst=t.igst, round_off=round_off,
        )
    audit(user, "create", "Sales return", ret.return_no, f"Recorded return against {inv.invoice_no}")
    return ret


@transaction.atomic
def reclassify_return_line(user, return_id: int, line_index: int, to: str, note: str) -> SalesReturn:
    ret = SalesReturn.objects.select_for_update().get(pk=return_id)
    lines = list(ret.lines.select_related("batch").order_by("pk"))
    if not 0 <= line_index < len(lines):
        raise DomainError("Return line not found.")
    line = lines[line_index]
    if line.classification != "inspection":
        raise DomainError("Only lines awaiting inspection can be reclassified.")
    lock_batches([line.batch_id])
    today = timezone.localdate()
    text = f"Inspection decision: {to}"
    post_movement(user=user, date=today, batch=line.batch, type="reclassification", bucket="inspection", qty=-line.qty,
                  ref_type="Sales return", ref_id=ret.pk, ref_no=ret.return_no, note=text)
    post_movement(user=user, date=today, batch=line.batch, type="reclassification", bucket=to, qty=line.qty,
                  ref_type="Sales return", ref_id=ret.pk, ref_no=ret.return_no, note=text)
    line.classification = to
    line.disposition_note = (note or "").strip() or f"Inspected: {to}"
    line.save(update_fields=["classification", "disposition_note"])
    audit(user, "update", "Sales return", ret.return_no, f"Returned stock marked {to} after inspection")
    return ret
