from django.db import models
from django.db.models import Q


class DistributionOrder(models.Model):
    STATUS = [
        ("draft", "Draft"),
        ("confirmed", "Confirmed"),
        ("partially_dispatched", "Partially dispatched"),
        ("dispatched", "Dispatched"),
        ("cancelled", "Cancelled"),
    ]

    order_no = models.CharField(max_length=30, unique=True)
    distributor = models.ForeignKey("parties.Distributor", on_delete=models.PROTECT, related_name="orders")
    date = models.DateField()
    expected_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=22, choices=STATUS, default="draft", db_index=True)
    notes = models.CharField(max_length=300, blank=True)


class OrderLine(models.Model):
    order = models.ForeignKey(DistributionOrder, on_delete=models.CASCADE, related_name="lines")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="+")
    qty = models.PositiveIntegerField()
    rate = models.DecimalField(max_digits=12, decimal_places=2)
    discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["order", "product"], name="uniq_orderline_product"),
            models.CheckConstraint(condition=Q(qty__gt=0), name="orderline_qty_positive"),
            models.CheckConstraint(condition=Q(discount_pct__gte=0) & Q(discount_pct__lte=100), name="orderline_discount_range"),
        ]


class Dispatch(models.Model):
    dispatch_no = models.CharField(max_length=30, unique=True)
    order = models.ForeignKey(DistributionOrder, on_delete=models.PROTECT, related_name="dispatches")
    distributor = models.ForeignKey("parties.Distributor", on_delete=models.PROTECT, related_name="dispatches")
    date = models.DateField()
    vehicle_no = models.CharField(max_length=30, blank=True)
    delivery_ref = models.CharField(max_length=40, blank=True)
    notes = models.CharField(max_length=300, blank=True)


class DispatchLine(models.Model):
    dispatch = models.ForeignKey(Dispatch, on_delete=models.CASCADE, related_name="lines")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="+")
    batch = models.ForeignKey("inventory.Batch", on_delete=models.PROTECT, related_name="+")
    qty = models.PositiveIntegerField()

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(qty__gt=0), name="dispatchline_qty_positive")]


class DistributorStockReport(models.Model):
    """Sales and remaining stock *reported by* the distributor. Dispatched quantity is never treated as sales."""

    SOURCES = [("manual", "Manual"), ("import", "Import")]

    distributor = models.ForeignKey("parties.Distributor", on_delete=models.PROTECT, related_name="stock_reports")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="stock_reports")
    period = models.CharField(max_length=7)  # YYYY-MM
    reported_sales = models.PositiveIntegerField()
    remaining_stock = models.PositiveIntegerField()
    returned = models.PositiveIntegerField(default=0)
    reported_on = models.DateField()
    source = models.CharField(max_length=10, choices=SOURCES, default="manual")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["distributor", "product", "period"], name="uniq_stock_report_period")]
