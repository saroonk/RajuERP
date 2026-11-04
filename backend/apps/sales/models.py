from django.db import models
from django.db.models import Q

CLASSIFICATIONS = [("saleable", "Saleable"), ("damaged", "Damaged"), ("expired", "Expired"), ("inspection", "Needs inspection")]
RETURN_REASONS = [
    ("expired", "Expired"),
    ("near_expiry", "Near expiry"),
    ("damaged", "Damaged"),
    ("wrong_item", "Wrong item"),
    ("quality_issue", "Quality issue"),
    ("other", "Other"),
]


class Invoice(models.Model):
    """Tax invoice. Totals are always computed on the server from the lines; clients never supply them."""

    invoice_no = models.CharField(max_length=30, unique=True)
    distributor = models.ForeignKey("parties.Distributor", on_delete=models.PROTECT, related_name="invoices")
    order = models.ForeignKey("distribution.DistributionOrder", on_delete=models.PROTECT, related_name="invoices")
    # One invoice per dispatch: prevents double billing the same goods.
    dispatch = models.OneToOneField("distribution.Dispatch", on_delete=models.PROTECT, related_name="invoice")
    date = models.DateField(db_index=True)
    due_date = models.DateField()
    inter_state = models.BooleanField(default=False)
    taxable = models.DecimalField(max_digits=14, decimal_places=2)
    cgst = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    sgst = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    igst = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    round_off = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(due_date__gte=models.F("date")), name="invoice_due_after_date"),
            # Intra-state invoices carry CGST+SGST, inter-state invoices carry IGST, never both.
            models.CheckConstraint(
                condition=(Q(inter_state=True, cgst=0, sgst=0) | Q(inter_state=False, igst=0)),
                name="invoice_tax_type_consistent",
            ),
        ]


class InvoiceLine(models.Model):
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="lines")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="+")
    batch = models.ForeignKey("inventory.Batch", on_delete=models.PROTECT, related_name="+")
    qty = models.PositiveIntegerField()
    rate = models.DecimalField(max_digits=12, decimal_places=2)
    discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2)
    taxable = models.DecimalField(max_digits=14, decimal_places=2)
    cgst = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    sgst = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    igst = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(qty__gt=0), name="invoiceline_qty_positive")]


class SalesReturn(models.Model):
    return_no = models.CharField(max_length=30, unique=True)
    distributor = models.ForeignKey("parties.Distributor", on_delete=models.PROTECT, related_name="sales_returns")
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="returns")
    date = models.DateField()
    reason = models.CharField(max_length=20, choices=RETURN_REASONS)
    notes = models.CharField(max_length=300, blank=True)


class SalesReturnLine(models.Model):
    sales_return = models.ForeignKey(SalesReturn, on_delete=models.CASCADE, related_name="lines")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="+")
    batch = models.ForeignKey("inventory.Batch", on_delete=models.PROTECT, related_name="+")
    qty = models.PositiveIntegerField()
    rate = models.DecimalField(max_digits=12, decimal_places=2)
    discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2)
    # Current disposition. `inspection` lines are pending a decision.
    classification = models.CharField(max_length=12, choices=CLASSIFICATIONS)
    disposition_note = models.CharField(max_length=250, blank=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(qty__gt=0), name="returnline_qty_positive")]


class NoteDocument(models.Model):
    """Credit or debit note against a distributor (optionally an invoice and/or a sales return)."""

    TYPES = [("credit", "Credit note"), ("debit", "Debit note")]

    note_no = models.CharField(max_length=30, unique=True)
    type = models.CharField(max_length=6, choices=TYPES)
    distributor = models.ForeignKey("parties.Distributor", on_delete=models.PROTECT, related_name="notes")
    invoice = models.ForeignKey(Invoice, null=True, blank=True, on_delete=models.PROTECT, related_name="notes")
    sales_return = models.OneToOneField(SalesReturn, null=True, blank=True, on_delete=models.PROTECT, related_name="credit_note")
    date = models.DateField()
    reason = models.CharField(max_length=250)
    taxable = models.DecimalField(max_digits=14, decimal_places=2)
    cgst = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    sgst = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    igst = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    # Only set on the credit note that completes a full return, so credits add up to the invoice's rounded total.
    round_off = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(taxable__gt=0), name="note_taxable_positive")]
