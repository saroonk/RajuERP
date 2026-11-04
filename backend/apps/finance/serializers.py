from rest_framework import serializers

from apps.core.money import q2
from apps.parties.models import Distributor

from .models import PAYMENT_MODES, Expense, ExpenseCategory

MODES = [m for m, _ in PAYMENT_MODES]
MONEY = dict(max_digits=14, decimal_places=2, coerce_to_string=False)


class AllocationInputSerializer(serializers.Serializer):
    invoice_id = serializers.IntegerField(min_value=1)
    amount = serializers.DecimalField(**MONEY)


class PaymentInputSerializer(serializers.Serializer):
    """Client input for a payment. Receipt numbers and allocation checks are server-side."""

    distributor_id = serializers.PrimaryKeyRelatedField(source="distributor", queryset=Distributor.objects.all())
    date = serializers.DateField()
    amount = serializers.DecimalField(**MONEY)
    mode = serializers.ChoiceField(choices=MODES)
    reference = serializers.CharField(required=False, allow_blank=True, max_length=60, default="")
    notes = serializers.CharField(required=False, allow_blank=True, max_length=250, default="")
    allocations = AllocationInputSerializer(many=True, required=False, default=list)

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        return q2(value)


class AllocateSerializer(serializers.Serializer):
    allocations = AllocationInputSerializer(many=True, allow_empty=False)


class ExpenseCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseCategory
        fields = ["id", "name"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Category name is required.")
        return value


class ExpenseSerializer(serializers.ModelSerializer):
    """Shape of the frontend `ExpenseRow`."""

    category_id = serializers.PrimaryKeyRelatedField(source="category", queryset=ExpenseCategory.objects.all())
    category_name = serializers.CharField(source="category.name", read_only=True)
    amount = serializers.DecimalField(**MONEY)

    class Meta:
        model = Expense
        fields = ["id", "expense_no", "date", "category_id", "category_name", "payee", "description", "amount", "mode"]
        read_only_fields = ["expense_no"]

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        return q2(value)

    def validate_payee(self, value):
        if not value.strip():
            raise serializers.ValidationError("Enter the payee.")
        return value.strip()
