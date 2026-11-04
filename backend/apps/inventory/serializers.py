from rest_framework import serializers

from .models import BUCKETS, Batch, Reconciliation, ReconciliationLine, StockMovement, WriteOff, WriteOffLine

BUCKET_CHOICES = [b for b, _ in BUCKETS]


class BatchSerializer(serializers.ModelSerializer):
    """Raw batch (detail endpoint)."""

    id = serializers.IntegerField(read_only=True)
    product_id = serializers.IntegerField(read_only=True)
    supplier_id = serializers.IntegerField(read_only=True)
    receipt_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Batch
        fields = ["id", "product_id", "batch_no", "mfg_date", "expiry_date", "received_qty", "cost_price", "supplier_id", "receipt_id", "received_on"]


class MovementSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    product_id = serializers.IntegerField(read_only=True)
    batch_id = serializers.IntegerField(read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    sku = serializers.CharField(source="product.sku", read_only=True)
    batch_no = serializers.CharField(source="batch.batch_no", read_only=True)

    class Meta:
        model = StockMovement
        fields = [
            "id", "date", "product_id", "batch_id", "type", "bucket", "qty", "ref_type", "ref_id", "ref_no", "note", "created_by",
            "product_name", "sku", "batch_no",
        ]


class WriteOffLineSerializer(serializers.ModelSerializer):
    batch_id = serializers.IntegerField(read_only=True)
    product_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = WriteOffLine
        fields = ["batch_id", "product_id", "bucket", "qty", "unit_cost"]


class WriteOffSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    lines = WriteOffLineSerializer(many=True, read_only=True)
    line_count = serializers.SerializerMethodField()
    total_qty = serializers.SerializerMethodField()

    class Meta:
        model = WriteOff
        fields = ["id", "write_off_no", "date", "reason", "lines", "total_value", "line_count", "total_qty"]

    def get_line_count(self, obj):
        return len(obj.lines.all())

    def get_total_qty(self, obj):
        return sum(l.qty for l in obj.lines.all())


class WriteOffLineInput(serializers.Serializer):
    batch_id = serializers.IntegerField()
    bucket = serializers.ChoiceField(choices=BUCKET_CHOICES)
    qty = serializers.IntegerField(min_value=1)


class WriteOffInput(serializers.Serializer):
    date = serializers.DateField()
    reason = serializers.CharField(max_length=250)
    lines = WriteOffLineInput(many=True)


class ReconciliationLineSerializer(serializers.ModelSerializer):
    batch_id = serializers.IntegerField(read_only=True)
    product_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = ReconciliationLine
        fields = ["batch_id", "product_id", "system_qty", "physical_qty", "applied_diff"]


class ReconciliationSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    lines = ReconciliationLineSerializer(many=True, read_only=True)
    total_variance = serializers.SerializerMethodField()
    approved_by = serializers.SerializerMethodField()

    class Meta:
        model = Reconciliation
        fields = ["id", "ref_no", "date", "status", "notes", "lines", "approved_by", "approved_on", "total_variance"]

    def get_total_variance(self, obj):
        return sum(l.applied_diff if l.applied_diff is not None else l.physical_qty - l.system_qty for l in obj.lines.all())

    def get_approved_by(self, obj):
        return obj.approved_by or None


class ReconciliationLineInput(serializers.Serializer):
    batch_id = serializers.IntegerField()
    physical_qty = serializers.IntegerField(min_value=0)


class ReconciliationInput(serializers.Serializer):
    date = serializers.DateField()
    notes = serializers.CharField(max_length=300, allow_blank=True, required=False, default="")
    lines = ReconciliationLineInput(many=True)
