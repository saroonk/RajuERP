from django.db import models
from django.db.models import Q


class Brand(models.Model):
    TYPES = [("own", "Own brand"), ("external", "External brand")]

    name = models.CharField(max_length=120, unique=True)
    type = models.CharField(max_length=10, choices=TYPES, default="own")
    active = models.BooleanField(default=True)
    notes = models.CharField(max_length=250, blank=True)

    def __str__(self):
        return self.name


class Category(models.Model):
    """Categories and subcategories share one table; a subcategory has a parent."""

    name = models.CharField(max_length=120)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="children")
    active = models.BooleanField(default=True)

    class Meta:
        verbose_name_plural = "categories"
        constraints = [
            models.UniqueConstraint(fields=["parent", "name"], name="uniq_category_parent_name"),
            # Top-level names must also be unique (NULL parents are not equal in a unique constraint).
            models.UniqueConstraint(fields=["name"], condition=Q(parent__isnull=True), name="uniq_top_category_name"),
        ]

    def __str__(self):
        return self.name


class Unit(models.Model):
    name = models.CharField(max_length=60)
    code = models.CharField(max_length=10, unique=True)

    def __str__(self):
        return self.code


class UnitConversion(models.Model):
    """1 `from_unit` = `factor` x `to_unit`."""

    from_unit = models.ForeignKey(Unit, on_delete=models.PROTECT, related_name="+")
    to_unit = models.ForeignKey(Unit, on_delete=models.PROTECT, related_name="+")
    factor = models.DecimalField(max_digits=12, decimal_places=3)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["from_unit", "to_unit"], name="uniq_unit_conversion"),
            models.CheckConstraint(condition=~Q(from_unit=models.F("to_unit")), name="conversion_distinct_units"),
            models.CheckConstraint(condition=Q(factor__gt=0), name="conversion_factor_positive"),
        ]


class Product(models.Model):
    sku = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=200)
    brand = models.ForeignKey(Brand, on_delete=models.PROTECT, related_name="products")
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="products")
    subcategory = models.ForeignKey(Category, null=True, blank=True, on_delete=models.PROTECT, related_name="sub_products")
    # All stock and transaction quantities are whole numbers of this base unit.
    unit = models.ForeignKey(Unit, on_delete=models.PROTECT, related_name="+")
    pack_unit = models.ForeignKey(Unit, on_delete=models.PROTECT, related_name="+")
    pack_size = models.PositiveIntegerField(default=1)
    purchase_price = models.DecimalField(max_digits=12, decimal_places=2)
    selling_price = models.DecimalField(max_digits=12, decimal_places=2)
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    hsn_code = models.CharField(max_length=10, blank=True)
    min_stock = models.PositiveIntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(pack_size__gte=1), name="product_pack_size_min_1"),
            models.CheckConstraint(condition=Q(purchase_price__gte=0) & Q(selling_price__gte=0), name="product_prices_non_negative"),
            models.CheckConstraint(condition=Q(gst_rate__gte=0) & Q(gst_rate__lte=100), name="product_gst_range"),
        ]

    def __str__(self):
        return f"{self.sku} {self.name}"
