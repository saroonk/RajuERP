from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.models import Settings
from apps.core.pagination import paginated

from . import services
from .models import Dispatch, DistributionOrder, DistributorStockReport
from .serializers import (
    DispatchInputSerializer,
    OrderInputSerializer,
    StockReportImportSerializer,
    StockReportInputSerializer,
)


class OrderViewSet(viewsets.GenericViewSet):
    permission_module = "distribution"
    serializer_class = OrderInputSerializer
    queryset = services.order_queryset()
    search_fields = ["order_no", "distributor__name"]
    filterset_fields = {"status": ["exact"], "distributor": ["exact"], "date": ["gte", "lte"]}
    ordering_fields = ["date", "order_no", "status"]
    ordering = ["-date", "-order_no"]
    http_method_names = ["get", "post", "put", "delete", "head", "options"]

    def _row(self, pk):
        return services.order_row(self.get_queryset().get(pk=pk))

    def list(self, request):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        state = Settings.load().state
        return self.get_paginated_response([services.order_row(o, state) for o in page])

    def retrieve(self, request, pk=None):
        return Response(services.order_row(self.get_object()))

    def create(self, request):
        s = OrderInputSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        order = services.create_order(request.user, s.validated_data)
        return Response(self._row(order.pk), status=status.HTTP_201_CREATED)

    def update(self, request, pk=None):
        order = self.get_object()
        s = OrderInputSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        services.update_order(request.user, order.pk, s.validated_data)
        return Response(self._row(order.pk))

    def destroy(self, request, pk=None):
        services.delete_order(request.user, self.get_object().pk)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        services.set_order_status(request.user, self.get_object().pk, "confirmed")
        return Response(self._row(pk))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        services.set_order_status(request.user, self.get_object().pk, "cancelled")
        return Response(self._row(pk))


class DispatchViewSet(viewsets.GenericViewSet):
    permission_module = "distribution"
    serializer_class = DispatchInputSerializer
    queryset = services.dispatch_queryset()
    search_fields = ["dispatch_no", "order__order_no", "distributor__name", "vehicle_no", "delivery_ref"]
    filterset_fields = {"distributor": ["exact"], "order": ["exact"], "date": ["gte", "lte"], "invoice": ["isnull"]}
    ordering_fields = ["date", "dispatch_no"]
    ordering = ["-date", "-dispatch_no"]
    http_method_names = ["get", "post", "head", "options"]

    def list(self, request):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        return self.get_paginated_response([services.dispatch_row(d) for d in page])

    def retrieve(self, request, pk=None):
        return Response(services.dispatch_row(self.get_object()))

    def create(self, request):
        s = DispatchInputSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        dispatch = services.create_dispatch(request.user, s.validated_data)
        return Response(services.dispatch_row(self.get_queryset().get(pk=dispatch.pk)), status=status.HTTP_201_CREATED)


class DistributorStockView(APIView):
    """Dispatched vs. distributor-reported sales and remaining stock (dispatched is never counted as sales)."""

    permission_module = "distribution"

    def get(self, request):
        return paginated(self, request, services.stock_rows())


class StockReportViewSet(viewsets.GenericViewSet):
    permission_module = "distribution"
    serializer_class = StockReportInputSerializer
    queryset = DistributorStockReport.objects.select_related("distributor", "product")
    search_fields = ["distributor__name", "product__name", "product__sku"]
    filterset_fields = ["distributor", "product", "period", "source"]
    ordering_fields = ["period", "reported_on"]
    ordering = ["-period", "-id"]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def list(self, request):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        return self.get_paginated_response([services.stock_report_row(r) for r in page])

    def create(self, request):
        s = StockReportInputSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        report, created = services.add_stock_report(request.user, s.validated_data)
        row = services.stock_report_row(self.get_queryset().get(pk=report.pk))
        return Response(row, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def destroy(self, request, pk=None):
        services.delete_stock_report(request.user, self.get_object().pk)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["post"], url_path="import", serializer_class=StockReportImportSerializer)
    def import_rows(self, request):
        s = StockReportImportSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        return Response(services.import_stock_reports(request.user, s.validated_data["rows"]))


__all__ = ["OrderViewSet", "DispatchViewSet", "DistributorStockView", "StockReportViewSet", "DistributionOrder", "Dispatch"]
