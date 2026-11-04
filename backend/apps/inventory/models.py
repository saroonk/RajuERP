from django.conf import settings
from django.db import models
from django.db.models import Q

BUCKETS = [("saleable", "Saleable"), ("damaged", "Damaged"), ("expired", "Expired"), ("inspection", "Inspection")]
MOVEMENT_TYPES = [
    ("receipt", "Receipt"),
    ("dispatch", "Dispatch"),
    ("sales_return", "Sales return"),
    ("supplier_return", "Supplier return"),
    ("adjustment", "Adjustment"),
    ("write_off", "Write-off"),
    ("reclassification", "Reclassification"),
]


class Batch(models.Model):
    """One delivery lot of a product. Batch numbers are unique per product."""

    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="batches")
    batch_no = models.CharField(max_length=40)
    mfg_date = models.DateField()
    expiry_date = models.DateField(db_index=True)
    received_qty = models.PositiveIntegerField(default=0)
    cost_price = models.DecimalField(max_digits=12, decimal_places=2)
    supplier = models.ForeignKey("parties.Supplier", on_delete=models.PROTECT, related_name="batches")
    receipt = models.ForeignKey("purchasing.GoodsReceipt", null=True, blank=True, on_delete=models.SET_NULL, related_name="batches")
    received_on = models.DateField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["product", "batch_no"], name="uniq_batch_product_no"),
            models.CheckConstraint(condition=Q(expiry_date__gt=models.F("mfg_date")), name="batch_expiry_after_mfg"),
        ]

    def __str__(self):
        return f"{self.batch_no} ({self.product_id})"


class StockMovement(models.Model):
    """Append-only stock ledger. Every quantity in the system is the sum of these signed rows."""

    date = models.DateField(db_index=True)
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="movements")
    batch = models.ForeignKey(Batch, on_delete=models.PROTECT, related_name="movements")
    type = models.CharField(max_length=20, choices=MOVEMENT_TYPES)
    bucket = models.CharField(max_length=10, choices=BUCKETS)
    qty = models.IntegerField()  # signed
    ref_type = models.CharField(max_length=40)
    ref_id = models.PositiveIntegerField(null=True, blank=True)
    ref_no = models.CharField(max_length=40)
    note = models.CharField(max_length=250, blank=True)
    created_by = models.CharField(max_length=150, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["batch", "bucket"])]
        constraints = [models.CheckConstraint(condition=~Q(qty=0), name="movement_qty_non_zero")]


class WriteOff(models.Model):
    write_off_no = models.CharField(max_length=30, unique=True)
    date = models.DateField()
    reason = models.CharField(max_length=250)
    total_value = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")


class WriteOffLine(models.Model):
    write_off = models.ForeignKey(WriteOff, on_delete=models.CASCADE, related_name="lines")
    batch = models.ForeignKey(Batch, on_delete=models.PROTECT, related_name="+")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="+")
    bucket = models.CharField(max_length=10, choices=BUCKETS)
    qty = models.PositiveIntegerField()
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2)


class Reconciliation(models.Model):
    STATUS = [("draft", "Draft"), ("approved", "Approved")]

    ref_no = models.CharField(max_length=30, unique=True)
    date = models.DateField()
    status = models.CharField(max_length=10, choices=STATUS, default="draft")
    notes = models.CharField(max_length=300, blank=True)
    approved_by = models.CharField(max_length=150, blank=True)
    approved_on = models.DateField(null=True, blank=True)


class ReconciliationLine(models.Model):
    reconciliation = models.ForeignKey(Reconciliation, on_delete=models.CASCADE, related_name="lines")
    batch = models.ForeignKey(Batch, on_delete=models.PROTECT, related_name="+")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="+")
    system_qty = models.IntegerField()
    physical_qty = models.PositiveIntegerField()
    applied_diff = models.IntegerField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["reconciliation", "batch"], name="uniq_recon_batch")]
