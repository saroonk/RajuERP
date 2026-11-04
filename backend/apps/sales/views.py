from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.exceptions import DomainError
from apps.core.pagination import paginated
from apps.distribution.services import dispatch_queryset, dispatch_row

from . import services
from .serializers import (
    InvoiceCreateSerializer,
    NoteInputSerializer,
    ReclassifySerializer,
    SalesReturnInputSerializer,
)


class InvoiceViewSet(viewsets.GenericViewSet):
    permission_module = "sales"
    serializer_class = InvoiceCreateSerializer
    queryset = services.invoice_queryset()
    search_fields = ["invoice_no", "distributor__name"]
    filterset_fields = {"distributor": ["exact"], "date": ["gte", "lte"], "due_date": ["gte", "lte"]}
    ordering_fields = ["date", "invoice_no", "total", "due_date"]
    ordering = ["-date", "-invoice_no"]
    http_method_names = ["get", "post", "head", "options"]

    def list(self, request):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        return self.get_paginated_response([services.invoice_row(i) for i in page])

    def retrieve(self, request, pk=None):
        return Response(services.invoice_row(self.get_object()))

    def create(self, request):
        s = InvoiceCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        inv = services.create_invoice_from_dispatch(request.user, s.validated_data["dispatch_id"], s.validated_data["date"])
        return Response(services.invoice_row(self.get_queryset().get(pk=inv.pk)), status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="uninvoiced-dispatches")
    def uninvoiced_dispatches(self, request):
        qs = dispatch_queryset().filter(invoice__isnull=True).order_by("-date", "-dispatch_no")
        page = self.paginate_queryset(qs)
        return self.get_paginated_response([dispatch_row(d) for d in page])


class NoteViewSet(viewsets.GenericViewSet):
    permission_module = "sales"
    serializer_class = NoteInputSerializer
    queryset = services.note_queryset()
    search_fields = ["note_no", "distributor__name", "reason", "invoice__invoice_no"]
    filterset_fields = {"type": ["exact"], "distributor": ["exact"], "invoice": ["exact"], "date": ["gte", "lte"]}
    ordering_fields = ["date", "note_no", "total"]
    ordering = ["-date", "-note_no"]
    http_method_names = ["get", "post", "head", "options"]

    def list(self, request):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        return self.get_paginated_response([services.note_row(n) for n in page])

    def retrieve(self, request, pk=None):
        return Response(services.note_row(self.get_object()))

    def create(self, request):
        s = NoteInputSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        note = services.create_note(request.user, s.validated_data)
        return Response(services.note_row(self.get_queryset().get(pk=note.pk)), status=status.HTTP_201_CREATED)


class SalesReturnViewSet(viewsets.GenericViewSet):
    permission_module = "sales"
    serializer_class = SalesReturnInputSerializer
    queryset = services.return_queryset()
    search_fields = ["return_no", "distributor__name", "invoice__invoice_no"]
    filterset_fields = {"distributor": ["exact"], "invoice": ["exact"], "reason": ["exact"], "date": ["gte", "lte"]}
    ordering_fields = ["date", "return_no"]
    ordering = ["-date", "-return_no"]
    http_method_names = ["get", "post", "head", "options"]

    def list(self, request):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        return self.get_paginated_response([services.return_row(r) for r in page])

    def retrieve(self, request, pk=None):
        return Response(services.return_row(self.get_object()))

    def create(self, request):
        s = SalesReturnInputSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        ret = services.create_sales_return(request.user, s.validated_data)
        return Response(services.return_row(self.get_queryset().get(pk=ret.pk)), status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="returnable-lines")
    def returnable_lines(self, request):
        raw = request.query_params.get("invoiceId") or request.query_params.get("invoice_id")
        if not raw or not raw.isdigit():
            raise DomainError("invoiceId is required.")
        return paginated(self, request, services.returnable_lines(int(raw)))

    @action(detail=True, methods=["post"], serializer_class=ReclassifySerializer)
    def reclassify(self, request, pk=None):
        s = ReclassifySerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        services.reclassify_return_line(request.user, self.get_object().pk, d["line_index"], d["to"], d["note"])
        return Response(services.return_row(self.get_queryset().get(pk=pk)))
