from django.db import models
from django.db.models import Q

PAYMENT_MODES = [("cash", "Cash"), ("bank_transfer", "Bank transfer"), ("upi", "UPI"), ("cheque", "Cheque"), ("other", "Other")]


class PurchaseOrder(models.Model):
    STATUS = [("draft", "Draft"), ("ordered", "Ordered"), ("partial", "Partially received"), ("received", "Received"), ("cancelled", "Cancelled")]

    po_no = models.CharField(max_length=30, unique=True)
    supplier = models.ForeignKey("parties.Supplier", on_delete=models.PROTECT, related_name="purchase_orders")
    date = models.DateField()
    expected_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUS, default="draft", db_index=True)
    notes = models.CharField(max_length=300, blank=True)


class POLine(models.Model):
    po = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name="lines")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="+")
    qty = models.PositiveIntegerField()
    rate = models.DecimalField(max_digits=12, decimal_places=2)
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["po", "product"], name="uniq_poline_product"),
            models.CheckConstraint(condition=Q(qty__gt=0), name="poline_qty_positive"),
        ]


class GoodsReceipt(models.Model):
    grn_no = models.CharField(max_length=30, unique=True)
    po = models.ForeignKey(PurchaseOrder, on_delete=models.PROTECT, related_name="receipts")
    supplier = models.ForeignKey("parties.Supplier", on_delete=models.PROTECT, related_name="receipts")
    date = models.DateField()
    supplier_invoice_no = models.CharField(max_length=40, blank=True)
    taxable = models.DecimalField(max_digits=14, decimal_places=2)
    tax = models.DecimalField(max_digits=14, decimal_places=2)
    total = models.DecimalField(max_digits=14, decimal_places=2)


class GRNLine(models.Model):
    receipt = models.ForeignKey(GoodsReceipt, on_delete=models.CASCADE, related_name="lines")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="+")
    batch = models.ForeignKey("inventory.Batch", on_delete=models.PROTECT, related_name="+")
    batch_no = models.CharField(max_length=40)
    mfg_date = models.DateField()
    expiry_date = models.DateField()
    qty = models.PositiveIntegerField()
    rate = models.DecimalField(max_digits=12, decimal_places=2)
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(qty__gt=0), name="grnline_qty_positive")]


class SupplierReturn(models.Model):
    return_no = models.CharField(max_length=30, unique=True)
    supplier = models.ForeignKey("parties.Supplier", on_delete=models.PROTECT, related_name="returns")
    date = models.DateField()
    reason = models.CharField(max_length=250, blank=True)
    taxable = models.DecimalField(max_digits=14, decimal_places=2)
    tax = models.DecimalField(max_digits=14, decimal_places=2)
    total = models.DecimalField(max_digits=14, decimal_places=2)


class SupplierReturnLine(models.Model):
    supplier_return = models.ForeignKey(SupplierReturn, on_delete=models.CASCADE, related_name="lines")
    batch = models.ForeignKey("inventory.Batch", on_delete=models.PROTECT, related_name="+")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="+")
    bucket = models.CharField(max_length=10)
    qty = models.PositiveIntegerField()
    rate = models.DecimalField(max_digits=12, decimal_places=2)
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)


class SupplierPayment(models.Model):
    payment_no = models.CharField(max_length=30, unique=True)
    supplier = models.ForeignKey("parties.Supplier", on_delete=models.PROTECT, related_name="payments")
    date = models.DateField()
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    mode = models.CharField(max_length=15, choices=PAYMENT_MODES)
    reference = models.CharField(max_length=60, blank=True)
    notes = models.CharField(max_length=250, blank=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(amount__gt=0), name="supplier_payment_positive")]
