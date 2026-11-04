"""Input serializers. Responses are the row dicts built in services.py. No totals or tax amounts are accepted."""

from decimal import Decimal

from rest_framework import serializers

from apps.catalog.models import Product
from apps.inventory.models import Batch
from apps.parties.models import Distributor

from .models import RETURN_REASONS, Invoice


class InvoiceCreateSerializer(serializers.Serializer):
    dispatch_id = serializers.IntegerField(min_value=1)
    date = serializers.DateField()


class NoteInputSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=["credit", "debit"])
    distributor_id = serializers.PrimaryKeyRelatedField(queryset=Distributor.objects.all(), source="distributor")
    invoice_id = serializers.PrimaryKeyRelatedField(queryset=Invoice.objects.all(), source="invoice", required=False, allow_null=True, default=None)
    date = serializers.DateField()
    reason = serializers.CharField(max_length=250)
    taxable = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))
    gst_rate = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=0, max_value=100)


class ReturnLineInputSerializer(serializers.Serializer):
    product_id = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all(), source="product")
    batch_id = serializers.PrimaryKeyRelatedField(queryset=Batch.objects.all(), source="batch")
    qty = serializers.IntegerField(min_value=1)
    classification = serializers.ChoiceField(choices=["saleable", "damaged", "expired", "inspection"])


class SalesReturnInputSerializer(serializers.Serializer):
    invoice_id = serializers.PrimaryKeyRelatedField(queryset=Invoice.objects.all(), source="invoice")
    date = serializers.DateField()
    reason = serializers.ChoiceField(choices=[r for r, _ in RETURN_REASONS])
    notes = serializers.CharField(required=False, allow_blank=True, max_length=300, default="")
    issue_credit_note = serializers.BooleanField(default=False)
    lines = ReturnLineInputSerializer(many=True)


class ReclassifySerializer(serializers.Serializer):
    line_index = serializers.IntegerField(min_value=0)
    to = serializers.ChoiceField(choices=["saleable", "damaged", "expired"])
    note = serializers.CharField(required=False, allow_blank=True, max_length=250, default="")
