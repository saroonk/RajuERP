from apps.core.protect import AuditedModelViewSet

from .models import Brand, Category, Product, Unit, UnitConversion
from .serializers import BrandSerializer, CategorySerializer, ProductSerializer, UnitConversionSerializer, UnitSerializer


class BrandViewSet(AuditedModelViewSet):
    permission_module = "products"
    entity_name = "Brand"
    queryset = Brand.objects.all()
    serializer_class = BrandSerializer
    search_fields = ["name", "notes"]
    filterset_fields = ["type", "active"]
    ordering_fields = ["name", "type"]
    ordering = ["name"]

    def name_of(self, obj):
        return obj.name

    def protect_checks(self, i):
        return [("products", i.products.all())]


class CategoryViewSet(AuditedModelViewSet):
    permission_module = "products"
    entity_name = "Category"
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    search_fields = ["name"]
    filterset_fields = ["parent", "active"]
    ordering_fields = ["name"]
    ordering = ["name"]

    def name_of(self, obj):
        return obj.name

    def protect_checks(self, i):
        return [("products", i.products.all()), ("subcategories", i.children.all()), ("subcategorised products", i.sub_products.all())]


class UnitViewSet(AuditedModelViewSet):
    permission_module = "products"
    entity_name = "Unit"
    queryset = Unit.objects.all()
    serializer_class = UnitSerializer
    search_fields = ["name", "code"]
    ordering_fields = ["name", "code"]
    ordering = ["name"]

    def name_of(self, obj):
        return obj.name

    def protect_checks(self, i):
        return [
            ("products", Product.objects.filter(unit=i)),
            ("products (pack unit)", Product.objects.filter(pack_unit=i)),
            ("unit conversions", UnitConversion.objects.filter(from_unit=i)),
            ("unit conversions", UnitConversion.objects.filter(to_unit=i)),
        ]


class UnitConversionViewSet(AuditedModelViewSet):
    permission_module = "products"
    entity_name = "Unit conversion"
    queryset = UnitConversion.objects.select_related("from_unit", "to_unit")
    serializer_class = UnitConversionSerializer
    filterset_fields = ["from_unit", "to_unit"]
    ordering = ["id"]

    def name_of(self, obj):
        return f"{obj.from_unit.code} to {obj.to_unit.code}"


class ProductViewSet(AuditedModelViewSet):
    permission_module = "products"
    entity_name = "Product"
    queryset = Product.objects.all()
    serializer_class = ProductSerializer
    search_fields = ["sku", "name", "hsn_code"]
    filterset_fields = ["brand", "category", "subcategory", "active"]
    ordering_fields = ["name", "sku", "selling_price", "purchase_price"]
    ordering = ["name"]

    def name_of(self, obj):
        return obj.name

    def protect_checks(self, i):
        return [
            ("batches", i.batches.all()),
            ("distributor prices", i.distributor_prices.all()),
            ("stock reports", i.stock_reports.all()),
        ]
