from django.db.models import Q
from django.http import Http404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import audit
from apps.core.exceptions import ConflictError, DomainError
from apps.core.numbering import next_doc_no
from apps.core.pagination import paginated
from apps.parties.models import Distributor

from . import selectors, services
from .models import Expense, ExpenseCategory, Payment
from .ranges import parse_range
from .serializers import AllocateSerializer, ExpenseCategorySerializer, ExpenseSerializer, PaymentInputSerializer


def _distributor_id(request) -> int:
    raw = request.query_params.get("distributorId") or request.query_params.get("distributor_id")
    if not raw or not str(raw).isdigit() or not Distributor.objects.filter(pk=raw).exists():
        raise DomainError("A valid distributorId is required.")
    return int(raw)


class BalancesView(APIView):
    permission_module = "receivables"

    def get(self, request):
        rows = sorted(selectors.distributor_balances(), key=lambda r: -r["balance"])
        return paginated(self, request, rows)


class LedgerView(APIView):
    permission_module = "receivables"

    def get(self, request):
        return paginated(self, request, selectors.ledger_for(_distributor_id(request)))


class OpenInvoicesView(APIView):
    permission_module = "receivables"

    def get(self, request):
        return paginated(self, request, selectors.open_invoice_rows(_distributor_id(request)))


class SuggestAllocationsView(APIView):
    permission_module = "receivables"

    def get(self, request):
        from rest_framework import serializers

        did = _distributor_id(request)
        try:
            amount = serializers.DecimalField(max_digits=14, decimal_places=2).run_validation(request.query_params.get("amount", ""))
        except serializers.ValidationError:
            raise DomainError("A valid amount is required.")
        return paginated(self, request, selectors.suggest_allocations(amount, selectors.open_invoice_rows(did)))


class PaymentViewSet(viewsets.ViewSet):
    """Receipts from distributors with optional invoice-wise allocation."""

    permission_module = "receivables"

    def list(self, request):
        qs = Payment.objects.all()
        q = request.query_params
        if q.get("distributor"):
            qs = qs.filter(distributor_id=q["distributor"])
        if q.get("mode"):
            qs = qs.filter(mode=q["mode"])
        if q.get("date_from"):
            qs = qs.filter(date__gte=q["date_from"])
        if q.get("date_to"):
            qs = qs.filter(date__lte=q["date_to"])
        if q.get("search"):
            qs = qs.filter(Q(receipt_no__icontains=q["search"]) | Q(reference__icontains=q["search"]) | Q(distributor__name__icontains=q["search"]))
        return paginated(self, request, selectors.payment_rows(qs.order_by("-date", "-receipt_no")))

    def retrieve(self, request, pk=None):
        rows = selectors.payment_rows(Payment.objects.filter(pk=pk)) if str(pk).isdigit() else []
        if not rows:
            raise Http404
        return Response(rows[0])

    def create(self, request):
        s = PaymentInputSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        payment = services.create_payment(request.user, **s.validated_data)
        return Response(selectors.payment_rows(Payment.objects.filter(pk=payment.pk))[0], status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def allocate(self, request, pk=None):
        if not Payment.objects.filter(pk=pk).exists():
            raise Http404
        s = AllocateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        services.allocate_payment(request.user, pk, s.validated_data["allocations"])
        return Response(selectors.payment_rows(Payment.objects.filter(pk=pk))[0])


class ExpenseViewSet(viewsets.ModelViewSet):
    permission_module = "expenses"
    serializer_class = ExpenseSerializer
    queryset = Expense.objects.select_related("category")
    search_fields = ["payee", "description", "expense_no"]
    filterset_fields = {"category": ["exact"], "mode": ["exact"], "date": ["gte", "lte"]}
    ordering_fields = ["date", "amount", "expense_no"]
    ordering = ["-date", "-expense_no"]

    def perform_create(self, serializer):
        exp = serializer.save(expense_no=next_doc_no("expense", serializer.validated_data["date"]))
        audit(self.request.user, "create", "Expense", exp.expense_no, f"Recorded expense of ₹{exp.amount}")

    def perform_update(self, serializer):
        exp = serializer.save()
        audit(self.request.user, "update", "Expense", exp.expense_no, "Updated expense")

    def perform_destroy(self, instance):
        ref = instance.expense_no
        instance.delete()
        audit(self.request.user, "delete", "Expense", ref, "Deleted expense")


class ExpenseCategoryViewSet(viewsets.ModelViewSet):
    permission_module = "expenses"
    serializer_class = ExpenseCategorySerializer
    queryset = ExpenseCategory.objects.all()
    search_fields = ["name"]
    ordering = ["name"]

    def perform_create(self, serializer):
        c = serializer.save()
        audit(self.request.user, "create", "Expense category", c.name, f"Created expense category {c.name}")

    def perform_update(self, serializer):
        c = serializer.save()
        audit(self.request.user, "update", "Expense category", c.name, f"Updated expense category {c.name}")

    def perform_destroy(self, instance):
        used = instance.expenses.count()
        if used:
            raise ConflictError(f'Cannot delete "{instance.name}": it is used by {used} expenses.')
        name = instance.name
        instance.delete()
        audit(self.request.user, "delete", "Expense category", name, f"Deleted expense category {name}")


class SummaryView(APIView):
    permission_module = "expenses"

    def get(self, request):
        frm, to = parse_range(request)
        return Response(selectors.income_expense_summary(frm, to))

