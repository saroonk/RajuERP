from django.db import models
from django.db.models import Q


class Supplier(models.Model):
    name = models.CharField(max_length=150, unique=True)
    contact_person = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    gstin = models.CharField(max_length=15, blank=True)
    address = models.CharField(max_length=250, blank=True)
    city = models.CharField(max_length=80, blank=True)
    state = models.CharField(max_length=60)
    active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class Distributor(models.Model):
    TYPES = [("distributor", "Distributor"), ("dealer", "Dealer")]

    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=150, unique=True)
    type = models.CharField(max_length=12, choices=TYPES, default="distributor")
    contact_person = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    gstin = models.CharField(max_length=15, blank=True)
    address = models.CharField(max_length=250, blank=True)
    city = models.CharField(max_length=80, blank=True)
    state = models.CharField(max_length=60)
    credit_limit = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    credit_days = models.PositiveIntegerField(default=30)
    payment_terms = models.CharField(max_length=200, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(credit_limit__gte=0), name="distributor_credit_limit_non_negative")]

    def __str__(self):
        return self.name


class DistributorPrice(models.Model):
    """Distributor-specific net price (per base unit, before discount) and commercial terms."""

    distributor = models.ForeignKey(Distributor, on_delete=models.PROTECT, related_name="prices")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="distributor_prices")
    price = models.DecimalField(max_digits=12, decimal_places=2)
    discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    terms = models.CharField(max_length=200, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["distributor", "product"], name="uniq_price_distributor_product"),
            models.CheckConstraint(condition=Q(discount_pct__gte=0) & Q(discount_pct__lte=100), name="price_discount_range"),
            models.CheckConstraint(condition=Q(price__gte=0), name="price_non_negative"),
        ]
