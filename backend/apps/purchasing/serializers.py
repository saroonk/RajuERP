from rest_framework import serializers

from apps.core.money import ZERO

from .models import (
    PAYMENT_MODES,
    GoodsReceipt,
    GRNLine,
    POLine,
    PurchaseOrder,
    SupplierPayment,
    SupplierReturn,
    SupplierReturnLine,
)
from .services import pending_by_product

BUCKETS = ["saleable", "damaged", "expired", "inspection"]


class POLineSerializer(serializers.ModelSerializer):
    product_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = POLine
        fields = ["product_id", "qty", "rate", "gst_rate"]


class PurchaseOrderRowSerializer(serializers.ModelSerializer):
    """`PurchaseOrderRow`: totals and receipt progress are computed on the server from the lines and receipts."""

    id = serializers.IntegerField(read_only=True)
    supplier_id = serializers.IntegerField(read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    lines = POLineSerializer(many=True, read_only=True)
    taxable = serializers.SerializerMethodField()
    tax = serializers.SerializerMethodField()
    total = serializers.SerializerMethodField()
    line_progress = serializers.SerializerMethodField()
    received_pct = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseOrder
        fields = [
            "id", "po_no", "supplier_id", "supplier_name", "date", "expected_date", "status", "lines", "notes",
            "taxable", "tax", "total", "line_progress", "received_pct",
        ]

    def _totals(self, obj):
        from apps.core.tax import purchase_totals

        cache = self.context.setdefault("_totals", {})
        if obj.pk not in cache:
            cache[obj.pk] = purchase_totals([(l.qty, l.rate, l.gst_rate) for l in obj.lines.all()])
        return cache[obj.pk]

    def get_taxable(self, obj):
        return self._totals(obj)[0]

    def get_tax(self, obj):
        return self._totals(obj)[1]

    def get_total(self, obj):
        return self._totals(obj)[2]

    def _pending(self, obj):
        cache = self.context.setdefault("_pending", {})
        if obj.pk not in cache:
            cache[obj.pk] = pending_by_product(obj)
        return cache[obj.pk]

    def get_line_progress(self, obj):
        pending = self._pending(obj)
        return [
            {"product_id": l.product_id, "ordered": l.qty, "received": l.qty - pending[l.product_id], "pending": pending[l.product_id]}
            for l in obj.lines.all()
        ]

    def get_received_pct(self, obj):
        ordered = sum(l.qty for l in obj.lines.all())
        done = ordered - sum(self._pending(obj).values())
        return round(done * 100 / ordered) if ordered else 0


class POLineInput(serializers.Serializer):
    product_id = serializers.IntegerField()
    qty = serializers.IntegerField(min_value=1)
    rate = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=ZERO)
    gst_rate = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=ZERO, max_value=100)


class POInput(serializers.Serializer):
    supplier_id = serializers.IntegerField()
    date = serializers.DateField()
    expected_date = serializers.DateField(allow_null=True, required=False, default=None)
    lines = POLineInput(many=True)
    notes = serializers.CharField(max_length=300, allow_blank=True, required=False, default="")
    status = serializers.ChoiceField(choices=["draft", "ordered"])


class POStatusInput(serializers.Serializer):
    status = serializers.ChoiceField(choices=["ordered", "cancelled"])


class GRNLineSerializer(serializers.ModelSerializer):
    product_id = serializers.IntegerField(read_only=True)
    batch_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = GRNLine
        fields = ["product_id", "batch_id", "batch_no", "mfg_date", "expiry_date", "qty", "rate", "gst_rate"]


class GoodsReceiptRowSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    po_id = serializers.IntegerField(read_only=True)
    supplier_id = serializers.IntegerField(read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    po_no = serializers.CharField(source="po.po_no", read_only=True)
    lines = GRNLineSerializer(many=True, read_only=True)

    class Meta:
        model = GoodsReceipt
        fields = ["id", "grn_no", "po_id", "po_no", "supplier_id", "supplier_name", "date", "supplier_invoice_no", "lines", "taxable", "tax", "total"]


class GRNLineInput(serializers.Serializer):
    product_id = serializers.IntegerField()
    batch_no = serializers.CharField(max_length=40)
    mfg_date = serializers.DateField()
    expiry_date = serializers.DateField()
    qty = serializers.IntegerField(min_value=1)


class GRNInput(serializers.Serializer):
    po_id = serializers.IntegerField()
    date = serializers.DateField()
    supplier_invoice_no = serializers.CharField(max_length=40, allow_blank=True, required=False, default="")
    lines = GRNLineInput(many=True)


class SupplierReturnLineSerializer(serializers.ModelSerializer):
    batch_id = serializers.IntegerField(read_only=True)
    product_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = SupplierReturnLine
        fields = ["batch_id", "product_id", "bucket", "qty", "rate", "gst_rate"]


class SupplierReturnRowSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    supplier_id = serializers.IntegerField(read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    lines = SupplierReturnLineSerializer(many=True, read_only=True)

    class Meta:
        model = SupplierReturn
        fields = ["id", "return_no", "supplier_id", "supplier_name", "date", "reason", "lines", "taxable", "tax", "total"]


class SupplierReturnLineInput(serializers.Serializer):
    batch_id = serializers.IntegerField()
    bucket = serializers.ChoiceField(choices=BUCKETS)
    qty = serializers.IntegerField(min_value=1)


class SupplierReturnInput(serializers.Serializer):
    supplier_id = serializers.IntegerField()
    date = serializers.DateField()
    reason = serializers.CharField(max_length=250, allow_blank=True, required=False, default="")
    lines = SupplierReturnLineInput(many=True)


class SupplierPaymentRowSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    supplier_id = serializers.IntegerField(read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)

    class Meta:
        model = SupplierPayment
        fields = ["id", "payment_no", "supplier_id", "supplier_name", "date", "amount", "mode", "reference", "notes"]


class SupplierPaymentInput(serializers.Serializer):
    supplier_id = serializers.IntegerField()
    date = serializers.DateField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=ZERO)
    mode = serializers.ChoiceField(choices=[m for m, _ in PAYMENT_MODES])
    reference = serializers.CharField(max_length=60, allow_blank=True, required=False, default="")
    notes = serializers.CharField(max_length=250, allow_blank=True, required=False, default="")
