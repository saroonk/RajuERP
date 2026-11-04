from apps.core.protect import AuditedModelViewSet

from .models import Distributor, DistributorPrice, Supplier
from .serializers import DistributorPriceSerializer, DistributorSerializer, SupplierSerializer


class SupplierViewSet(AuditedModelViewSet):
    permission_module = "purchases"
    entity_name = "Supplier"
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    search_fields = ["name", "gstin", "city", "contact_person"]
    filterset_fields = ["state", "active"]
    ordering_fields = ["name", "city", "state"]
    ordering = ["name"]

    def name_of(self, obj):
        return obj.name

    def protect_checks(self, i):
        return [("purchase orders", i.purchase_orders.all()), ("supplier payments", i.payments.all()), ("batches", i.batches.all())]


class DistributorViewSet(AuditedModelViewSet):
    permission_module = "distributors"
    entity_name = "Distributor"
    queryset = Distributor.objects.all()
    serializer_class = DistributorSerializer
    search_fields = ["name", "code", "gstin", "city"]
    filterset_fields = ["type", "state", "active"]
    ordering_fields = ["name", "code", "credit_limit"]
    ordering = ["name"]

    def name_of(self, obj):
        return obj.name

    def protect_checks(self, i):
        return [
            ("orders", i.orders.all()),
            ("invoices", i.invoices.all()),
            ("payments", i.payments.all()),
            ("distributor prices", i.prices.all()),
        ]


class DistributorPriceViewSet(AuditedModelViewSet):
    permission_module = "distributors"
    entity_name = "Distributor price"
    queryset = DistributorPrice.objects.select_related("distributor", "product")
    serializer_class = DistributorPriceSerializer
    search_fields = ["distributor__name", "product__name", "product__sku"]
    filterset_fields = ["distributor", "product"]
    ordering = ["distributor__name", "product__name"]

    def name_of(self, obj):
        return f"{obj.distributor.name} / {obj.product.name}"
