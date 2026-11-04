from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_date
from django_filters import rest_framework as filters
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import DomainError
from apps.core.pagination import paginated

from . import services
from .models import Batch, Reconciliation, StockMovement, WriteOff
from .selectors import batch_stock_rows, product_stock_rows
from .serializers import (
    BatchSerializer,
    MovementSerializer,
    ReconciliationInput,
    ReconciliationSerializer,
    WriteOffInput,
    WriteOffSerializer,
)


def qp(request, *names, default=None):
    """Query parameter by any of its names (the frontend sends camelCase, API clients may send snake_case)."""
    for n in names:
        v = request.query_params.get(n)
        if v not in (None, ""):
            return v
    return default


def qp_int(request, *names, required=False):
    v = qp(request, *names)
    if v is None:
        if required:
            raise DomainError(f"{names[0]} is required.")
        return None
    try:
        return int(v)
    except ValueError:
        raise DomainError(f"{names[0]} must be a number.")


def qp_date(request, *names):
    v = parse_date(qp(request, *names, default="") or "")
    if v is None:
        raise DomainError(f"A valid {names[0]} (YYYY-MM-DD) is required.")
    return v


def _search(rows, term, *keys):
    term = (term or "").strip().lower()
    if not term:
        return rows
    return [r for r in rows if any(term in str(r[k]).lower() for k in keys)]


class StockByProductView(APIView):
    permission_module = "inventory"

    def get(self, request):
        rows = product_stock_rows()
        for param, key in (("brand", "brand_id"), ("category", "category_id")):
            if qp(request, param):
                rows = [r for r in rows if str(r[key]) == qp(request, param)]
        if qp(request, "status"):
            rows = [r for r in rows if r["stock_status"] == qp(request, "status")]
        return paginated(self, request, _search(rows, qp(request, "search"), "sku", "name", "brand_name"))


class BatchViewSet(viewsets.ViewSet):
    permission_module = "inventory"

    def list(self, request):
        rows = batch_stock_rows(product_id=qp_int(request, "product", "productId"))
        if qp(request, "expiry_status", "expiryStatus"):
            rows = [r for r in rows if r["expiry_status"] == qp(request, "expiry_status", "expiryStatus")]
        if qp(request, "with_stock", "withStock") in ("1", "true", "True"):
            rows = [r for r in rows if r["on_hand"] > 0]
        return paginated(self, request, _search(rows, qp(request, "search"), "batch_no", "product_name", "sku"))

    def retrieve(self, request, pk=None):
        return Response(BatchSerializer(get_object_or_404(Batch, pk=pk)).data)


class MovementFilter(filters.FilterSet):
    date_from = filters.DateFilter(field_name="date", lookup_expr="gte")
    date_to = filters.DateFilter(field_name="date", lookup_expr="lte")

    class Meta:
        model = StockMovement
        fields = ["batch", "product", "type", "bucket"]


class MovementViewSet(viewsets.ReadOnlyModelViewSet):
    permission_module = "inventory"
    queryset = StockMovement.objects.select_related("product", "batch")
    serializer_class = MovementSerializer
    filterset_class = MovementFilter
    search_fields = ["ref_no", "batch__batch_no", "product__name", "product__sku", "note"]
    ordering_fields = ["date", "qty", "id"]
    ordering = ["-date", "-id"]


class ValuationView(APIView):
    permission_module = "inventory"

    def get(self, request):
        from apps.core.models import Settings

        method = qp(request, "method", default=Settings.load().valuation_method)
        if method not in ("fifo", "weighted_average"):
            raise DomainError("method must be 'fifo' or 'weighted_average'.")
        return paginated(self, request, _search(services.valuation_rows(method), qp(request, "search"), "sku", "name", "brand_name"))


class AlertsView(APIView):
    permission_module = "dashboard"

    def get(self, request):
        return Response(services.alerts_summary())


class WriteOffViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_module = "inventory"
    queryset = WriteOff.objects.prefetch_related("lines")
    serializer_class = WriteOffSerializer
    search_fields = ["write_off_no", "reason"]
    ordering = ["-date", "-id"]

    def create(self, request):
        s = WriteOffInput(data=request.data)
        s.is_valid(raise_exception=True)
        wo = services.create_write_off(request.user, s.validated_data)
        wo = WriteOff.objects.prefetch_related("lines").get(pk=wo.pk)
        return Response(WriteOffSerializer(wo).data, status=status.HTTP_201_CREATED)


class ReconciliationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_module = "inventory"
    queryset = Reconciliation.objects.prefetch_related("lines")
    serializer_class = ReconciliationSerializer
    search_fields = ["ref_no", "notes"]
    filterset_fields = ["status"]
    ordering = ["-date", "-id"]

    def create(self, request):
        s = ReconciliationInput(data=request.data)
        s.is_valid(raise_exception=True)
        rec = services.create_reconciliation(request.user, s.validated_data)
        return Response(ReconciliationSerializer(self.get_queryset().get(pk=rec.pk)).data, status=status.HTTP_201_CREATED)

    def destroy(self, request, pk=None):
        services.delete_reconciliation(request.user, int(pk))
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        rec = services.approve_reconciliation(request.user, int(pk))
        return Response(ReconciliationSerializer(self.get_queryset().get(pk=rec.pk)).data)


class SuggestAllocationView(APIView):
    permission_module = "inventory"

    def get(self, request):
        exclude = {}
        for part in (qp(request, "exclude", default="") or "").split(","):
            if ":" in part:
                try:
                    k, v = part.split(":")
                    exclude[int(k)] = int(v)
                except ValueError:
                    raise DomainError("exclude must look like batchId:qty,batchId:qty.")
        qty = qp_int(request, "qty", required=True)
        return Response(services.suggest_allocation(qp_int(request, "productId", "product_id", required=True), qty, qp_date(request, "date"), exclude))


class DispatchableBatchesView(APIView):
    permission_module = "inventory"

    def get(self, request):
        rows = services.dispatchable_batch_rows(qp_int(request, "productId", "product_id", required=True), qp_date(request, "date"))
        return paginated(self, request, rows)
