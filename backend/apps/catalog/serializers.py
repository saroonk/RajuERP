from rest_framework import serializers

from .models import Brand, Category, Product, Unit, UnitConversion


class _IdMixin(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)


class BrandSerializer(_IdMixin):
    class Meta:
        model = Brand
        fields = ["id", "name", "type", "active", "notes"]
        extra_kwargs = {"name": {"validators": []}, "notes": {"required": False, "allow_blank": True}}

    def validate_name(self, value):
        value = value.strip()
        qs = Brand.objects.filter(name__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(f'Brand "{value}" already exists.')
        return value


class CategorySerializer(_IdMixin):
    parent_id = serializers.PrimaryKeyRelatedField(source="parent", queryset=Category.objects.all(), allow_null=True, required=False)

    class Meta:
        model = Category
        fields = ["id", "name", "parent_id", "active"]

    def validate(self, attrs):
        name = attrs.get("name", getattr(self.instance, "name", "")).strip()
        parent = attrs.get("parent", getattr(self.instance, "parent", None))
        attrs["name"] = name
        if parent is not None:
            if parent.parent_id is not None:
                raise serializers.ValidationError({"parent_id": "A subcategory must belong to a top-level category."})
            if self.instance and parent.pk == self.instance.pk:
                raise serializers.ValidationError({"parent_id": "A category cannot be its own parent."})
        if self.instance and parent is not None and self.instance.children.exists():
            raise serializers.ValidationError({"parent_id": "This category has subcategories and cannot become a subcategory."})
        dup = Category.objects.filter(parent=parent, name__iexact=name)
        if self.instance:
            dup = dup.exclude(pk=self.instance.pk)
        if dup.exists():
            raise serializers.ValidationError({"name": f'Category "{name}" already exists here.'})
        return attrs


class UnitSerializer(_IdMixin):
    class Meta:
        model = Unit
        fields = ["id", "name", "code"]
        extra_kwargs = {"code": {"validators": []}}

    def validate_code(self, value):
        value = value.strip()
        qs = Unit.objects.filter(code__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(f'Unit "{value}" already exists.')
        return value


class UnitConversionSerializer(_IdMixin):
    from_unit_id = serializers.PrimaryKeyRelatedField(source="from_unit", queryset=Unit.objects.all())
    to_unit_id = serializers.PrimaryKeyRelatedField(source="to_unit", queryset=Unit.objects.all())

    class Meta:
        model = UnitConversion
        fields = ["id", "from_unit_id", "to_unit_id", "factor"]

    def validate_factor(self, value):
        if value <= 0:
            raise serializers.ValidationError("Factor must be greater than zero.")
        return value

    def validate(self, attrs):
        frm = attrs.get("from_unit", getattr(self.instance, "from_unit", None))
        to = attrs.get("to_unit", getattr(self.instance, "to_unit", None))
        if frm and to:
            if frm.pk == to.pk:
                raise serializers.ValidationError({"to_unit_id": "From and to units must be different."})
            dup = UnitConversion.objects.filter(from_unit=frm, to_unit=to)
            if self.instance:
                dup = dup.exclude(pk=self.instance.pk)
            if dup.exists():
                raise serializers.ValidationError("Conversion already exists for these units.")
        return attrs


class ProductSerializer(_IdMixin):
    brand_id = serializers.PrimaryKeyRelatedField(source="brand", queryset=Brand.objects.all())
    category_id = serializers.PrimaryKeyRelatedField(source="category", queryset=Category.objects.all())
    subcategory_id = serializers.PrimaryKeyRelatedField(source="subcategory", queryset=Category.objects.all(), allow_null=True, required=False)
    unit_id = serializers.PrimaryKeyRelatedField(source="unit", queryset=Unit.objects.all())
    pack_unit_id = serializers.PrimaryKeyRelatedField(source="pack_unit", queryset=Unit.objects.all())

    class Meta:
        model = Product
        fields = [
            "id", "sku", "name", "brand_id", "category_id", "subcategory_id", "unit_id", "pack_unit_id", "pack_size",
            "purchase_price", "selling_price", "gst_rate", "hsn_code", "min_stock", "active",
        ]
        extra_kwargs = {"sku": {"validators": []}, "hsn_code": {"required": False, "allow_blank": True}}

    def validate_sku(self, value):
        value = value.strip()
        qs = Product.objects.filter(sku__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(f'SKU "{value}" already exists.')
        return value

    def validate_pack_size(self, value):
        if value < 1:
            raise serializers.ValidationError("Pack size must be at least 1.")
        return value

    def validate_purchase_price(self, value):
        if value < 0:
            raise serializers.ValidationError("Price cannot be negative.")
        return value

    validate_selling_price = validate_purchase_price

    def validate_gst_rate(self, value):
        if not 0 <= value <= 100:
            raise serializers.ValidationError("GST rate must be between 0 and 100.")
        return value

    def validate(self, attrs):
        category = attrs.get("category", getattr(self.instance, "category", None))
        sub = attrs.get("subcategory", getattr(self.instance, "subcategory", None))
        if category is not None and category.parent_id is not None:
            raise serializers.ValidationError({"category_id": "Choose a top-level category."})
        if sub is not None and (category is None or sub.parent_id != category.pk):
            raise serializers.ValidationError({"subcategory_id": "Subcategory must belong to the selected category."})
        return attrs
