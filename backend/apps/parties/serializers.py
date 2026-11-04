import re

from rest_framework import serializers

from apps.catalog.models import Product
from apps.core.serializers import validate_gstin

from .models import Distributor, DistributorPrice, Supplier


def _unique_name(model, value, instance, label):
    value = value.strip()
    qs = model.objects.filter(name__iexact=value)
    if instance:
        qs = qs.exclude(pk=instance.pk)
    if qs.exists():
        raise serializers.ValidationError(f'{label} "{value}" already exists.')
    return value


class SupplierSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Supplier
        fields = ["id", "name", "contact_person", "phone", "email", "gstin", "address", "city", "state", "active"]
        extra_kwargs = {
            "name": {"validators": []},
            **{f: {"required": False, "allow_blank": True} for f in ("contact_person", "phone", "email", "gstin", "address", "city")},
        }

    def validate_name(self, value):
        return _unique_name(Supplier, value, self.instance, "Supplier")

    def validate_gstin(self, value):
        return validate_gstin(value)

    def validate_phone(self, value):
        if value and not re.match(r"^[+\d][\d\s-]{7,15}$", value.strip()):
            raise serializers.ValidationError("Enter a valid phone number.")
        return value.strip()


class DistributorSerializer(SupplierSerializer):
    class Meta:
        model = Distributor
        fields = [
            "id", "code", "name", "type", "contact_person", "phone", "email", "gstin", "address", "city", "state",
            "credit_limit", "credit_days", "payment_terms", "active",
        ]
        extra_kwargs = {
            "name": {"validators": []},
            "code": {"validators": [], "required": False, "allow_blank": True},
            **{f: {"required": False, "allow_blank": True} for f in ("contact_person", "phone", "email", "gstin", "address", "city", "payment_terms")},
        }

    def validate_name(self, value):
        return _unique_name(Distributor, value, self.instance, "Distributor")

    def validate_code(self, value):
        value = value.strip().upper()
        if not value:
            return value
        qs = Distributor.objects.filter(code__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(f'Distributor code "{value}" already exists.')
        return value

    def validate_credit_limit(self, value):
        if value < 0:
            raise serializers.ValidationError("Credit limit cannot be negative.")
        return value

    def create(self, validated):
        if not validated.get("code"):
            validated["code"] = next_distributor_code()
        return super().create(validated)

    def update(self, instance, validated):
        if "code" in validated and not validated["code"]:
            validated.pop("code")  # never blank an existing code
        return super().update(instance, validated)


def next_distributor_code() -> str:
    nums = [int(m.group(1)) for c in Distributor.objects.values_list("code", flat=True) if (m := re.match(r"^D(\d+)$", c))]
    return f"D{(max(nums) + 1 if nums else 1):03d}"


class DistributorPriceSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    distributor_id = serializers.PrimaryKeyRelatedField(source="distributor", queryset=Distributor.objects.all())
    product_id = serializers.PrimaryKeyRelatedField(source="product", queryset=Product.objects.all())

    class Meta:
        model = DistributorPrice
        fields = ["id", "distributor_id", "product_id", "price", "discount_pct", "terms"]
        extra_kwargs = {"terms": {"required": False, "allow_blank": True}}

    def validate_price(self, value):
        if value < 0:
            raise serializers.ValidationError("Price cannot be negative.")
        return value

    def validate_discount_pct(self, value):
        if not 0 <= value <= 100:
            raise serializers.ValidationError("Discount must be between 0 and 100%.")
        return value

    def validate(self, attrs):
        d = attrs.get("distributor", getattr(self.instance, "distributor", None))
        p = attrs.get("product", getattr(self.instance, "product", None))
        dup = DistributorPrice.objects.filter(distributor=d, product=p)
        if self.instance:
            dup = dup.exclude(pk=self.instance.pk)
        if dup.exists():
            raise serializers.ValidationError("Price for this distributor and product already exists.")
        return attrs
