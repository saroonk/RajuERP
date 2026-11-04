from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.pagination import paginated

from . import services
from .models import GoodsReceipt, PurchaseOrder, SupplierPayment, SupplierReturn
from .serializers import (
    GoodsReceiptRowSerializer,
    GRNInput,
    POInput,
    POStatusInput,
    PurchaseOrderRowSerializer,
    SupplierPaymentInput,
    SupplierPaymentRowSerializer,
    SupplierReturnInput,
    SupplierReturnRowSerializer,
)

PO_QS = PurchaseOrder.objects.select_related("supplier").prefetch_related("lines__product")


class PurchaseOrderViewSet(viewsets.ReadOnlyModelViewSet):
    permission_module = "purchases"
    queryset = PO_QS
    serializer_class = PurchaseOrderRowSerializer
    search_fields = ["po_no", "supplier__name", "notes"]
    filterset_fields = ["status", "supplier"]
    ordering_fields = ["date", "po_no", "status"]
    ordering = ["-date", "-po_no"]

    def _row(self, po):
        return Response(PurchaseOrderRowSerializer(PO_QS.get(pk=po.pk), context={}).data)

    def create(self, request):
        s = POInput(data=request.data)
        s.is_valid(raise_exception=True)
        resp = self._row(services.create_po(request.user, s.validated_data))
        resp.status_code = status.HTTP_201_CREATED
        return resp

    def update(self, request, pk=None, partial=False):
        s = POInput(data=request.data)
        s.is_valid(raise_exception=True)
        return self._row(services.update_po(request.user, int(pk), s.validated_data))

    def partial_update(self, request, pk=None):
        return self.update(request, pk)

    def destroy(self, request, pk=None):
        services.delete_po(request.user, int(pk))
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="set-status")
    def set_status(self, request, pk=None):
        s = POStatusInput(data=request.data)
        s.is_valid(raise_exception=True)
        return self._row(services.set_po_status(request.user, int(pk), s.validated_data["status"]))


class GoodsReceiptViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_module = "purchases"
    queryset = GoodsReceipt.objects.select_related("supplier", "po").prefetch_related("lines")
    serializer_class = GoodsReceiptRowSerializer
    search_fields = ["grn_no", "supplier__name", "po__po_no", "supplier_invoice_no"]
    filterset_fields = ["supplier", "po"]
    ordering_fields = ["date", "grn_no", "total"]
    ordering = ["-date", "-grn_no"]

    def create(self, request):
        s = GRNInput(data=request.data)
        s.is_valid(raise_exception=True)
        grn = services.receive_goods(request.user, s.validated_data)
        return Response(GoodsReceiptRowSerializer(self.get_queryset().get(pk=grn.pk)).data, status=status.HTTP_201_CREATED)


class SupplierReturnViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_module = "purchases"
    queryset = SupplierReturn.objects.select_related("supplier").prefetch_related("lines")
    serializer_class = SupplierReturnRowSerializer
    search_fields = ["return_no", "supplier__name", "reason"]
    filterset_fields = ["supplier"]
    ordering = ["-date", "-return_no"]

    def create(self, request):
        s = SupplierReturnInput(data=request.data)
        s.is_valid(raise_exception=True)
        ret = services.create_supplier_return(request.user, s.validated_data)
        return Response(SupplierReturnRowSerializer(self.get_queryset().get(pk=ret.pk)).data, status=status.HTTP_201_CREATED)


class SupplierPaymentViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    permission_module = "payables"
    queryset = SupplierPayment.objects.select_related("supplier")
    serializer_class = SupplierPaymentRowSerializer
    search_fields = ["payment_no", "supplier__name", "reference"]
    filterset_fields = ["supplier", "mode"]
    ordering = ["-date", "-payment_no"]

    def create(self, request):
        s = SupplierPaymentInput(data=request.data)
        s.is_valid(raise_exception=True)
        p = services.create_supplier_payment(request.user, s.validated_data)
        return Response(SupplierPaymentRowSerializer(self.get_queryset().get(pk=p.pk)).data, status=status.HTTP_201_CREATED)


class SupplierOutstandingView(APIView):
    permission_module = "payables"

    def get(self, request):
        return paginated(self, request, services.supplier_outstanding_rows())
