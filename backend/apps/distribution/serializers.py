"""Input serializers (validation of request bodies). Responses are the row dicts built in services.py."""

from rest_framework import serializers

from apps.catalog.models import Product
from apps.inventory.models import Batch
from apps.parties.models import Distributor

from .models import DistributionOrder


class OrderLineInputSerializer(serializers.Serializer):
    product_id = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all(), source="product")
    qty = serializers.IntegerField(min_value=1)
    rate = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    discount_pct = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=0, max_value=100, default=0)
    # Accepted for compatibility with the frontend, but the server always uses the product's GST rate.
    gst_rate = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=0, max_value=100, required=False)


class OrderInputSerializer(serializers.Serializer):
    distributor_id = serializers.PrimaryKeyRelatedField(queryset=Distributor.objects.all(), source="distributor")
    date = serializers.DateField()
    expected_date = serializers.DateField(required=False, allow_null=True, default=None)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=300, default="")
    status = serializers.ChoiceField(choices=["draft", "confirmed"], default="draft")
    lines = OrderLineInputSerializer(many=True)

    def validate(self, attrs):
        if attrs.get("expected_date") and attrs["expected_date"] < attrs["date"]:
            raise serializers.ValidationError({"expected_date": "Expected date cannot be before the order date."})
        return attrs


class DispatchLineInputSerializer(serializers.Serializer):
    product_id = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all(), source="product")
    batch_id = serializers.PrimaryKeyRelatedField(queryset=Batch.objects.all(), source="batch")
    qty = serializers.IntegerField(min_value=1)


class DispatchInputSerializer(serializers.Serializer):
    order_id = serializers.PrimaryKeyRelatedField(queryset=DistributionOrder.objects.all(), source="order")
    date = serializers.DateField()
    vehicle_no = serializers.CharField(required=False, allow_blank=True, max_length=30, default="")
    delivery_ref = serializers.CharField(required=False, allow_blank=True, max_length=40, default="")
    notes = serializers.CharField(required=False, allow_blank=True, max_length=300, default="")
    lines = DispatchLineInputSerializer(many=True)


class StockReportInputSerializer(serializers.Serializer):
    distributor_id = serializers.PrimaryKeyRelatedField(queryset=Distributor.objects.all(), source="distributor")
    product_id = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all(), source="product")
    period = serializers.RegexField(r"^\d{4}-(0[1-9]|1[0-2])$", error_messages={"invalid": "Period must be in YYYY-MM format."})
    reported_sales = serializers.IntegerField(min_value=0)
    remaining_stock = serializers.IntegerField(min_value=0)
    returned = serializers.IntegerField(min_value=0, default=0)


class StockReportImportSerializer(serializers.Serializer):
    rows = serializers.ListField(child=serializers.ListField(child=serializers.CharField(allow_blank=True)), allow_empty=False)
