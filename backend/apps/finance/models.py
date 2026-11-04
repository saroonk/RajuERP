from django.db import models
from django.db.models import Q

PAYMENT_MODES = [("cash", "Cash"), ("bank_transfer", "Bank transfer"), ("upi", "UPI"), ("cheque", "Cheque"), ("other", "Other")]


class Payment(models.Model):
    """Money received from a distributor. May be allocated to one or more invoices; any remainder stays on account."""

    receipt_no = models.CharField(max_length=30, unique=True)
    distributor = models.ForeignKey("parties.Distributor", on_delete=models.PROTECT, related_name="payments")
    date = models.DateField(db_index=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    mode = models.CharField(max_length=15, choices=PAYMENT_MODES)
    reference = models.CharField(max_length=60, blank=True)
    notes = models.CharField(max_length=250, blank=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(amount__gt=0), name="payment_amount_positive")]


class PaymentAllocation(models.Model):
    payment = models.ForeignKey(Payment, on_delete=models.CASCADE, related_name="allocations")
    invoice = models.ForeignKey("sales.Invoice", on_delete=models.PROTECT, related_name="allocations")
    amount = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["payment", "invoice"], name="uniq_allocation_payment_invoice"),
            models.CheckConstraint(condition=Q(amount__gt=0), name="allocation_amount_positive"),
        ]


class ExpenseCategory(models.Model):
    name = models.CharField(max_length=80, unique=True)

    class Meta:
        verbose_name_plural = "expense categories"


class Expense(models.Model):
    expense_no = models.CharField(max_length=30, unique=True)
    date = models.DateField(db_index=True)
    category = models.ForeignKey(ExpenseCategory, on_delete=models.PROTECT, related_name="expenses")
    payee = models.CharField(max_length=150)
    description = models.CharField(max_length=250, blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    mode = models.CharField(max_length=15, choices=PAYMENT_MODES)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(amount__gt=0), name="expense_amount_positive")]
