from decimal import Decimal

from django.db import IntegrityError, transaction

from apps.catalog.models import Brand, Category, Product, UnitConversion
from apps.core.testing import ERPTestCase


class CatalogModelTests(ERPTestCase):
    def test_sku_is_unique(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Product.objects.create(
                sku="SKU-1", name="Dup", brand=self.product.brand, category=self.product.category, unit=self.product.unit,
                pack_unit=self.product.pack_unit, purchase_price=1, selling_price=2,
            )

    def test_negative_price_rejected_by_database(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Product.objects.create(
                sku="NEG", name="Neg", brand=self.product.brand, category=self.product.category, unit=self.product.unit,
                pack_unit=self.product.pack_unit, purchase_price=-1, selling_price=2,
            )

    def test_conversion_between_same_unit_rejected_by_database(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            UnitConversion.objects.create(from_unit=self.product.unit, to_unit=self.product.unit, factor=Decimal("2"))


class CatalogApiTests(ERPTestCase):
    def product_payload(self, **over):
        p = self.product
        body = {
            "sku": "NEW-1", "name": "New product", "brandId": p.brand_id, "categoryId": p.category_id, "subcategoryId": None,
            "unitId": p.unit_id, "packUnitId": p.pack_unit_id, "packSize": 6, "purchasePrice": "10.50", "sellingPrice": "14.00",
            "gstRate": "12", "hsnCode": "1905", "minStock": 5, "active": True,
        }
        body.update(over)
        return body

    def test_requires_authentication(self):
        self.assertIn(self.client_as(None).get("/api/products/").status_code, (401, 403))

    def test_list_is_paginated_and_camel_cased(self):
        r = self.client_as("accounts").get("/api/products/")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(set(body), {"count", "next", "previous", "results"})
        self.assertEqual(body["count"], 2)
        first = body["results"][0]
        for key in ("brandId", "categoryId", "packSize", "purchasePrice", "sellingPrice", "gstRate", "minStock"):
            self.assertIn(key, first)
        self.assertIsInstance(first["sellingPrice"], (int, float))  # numbers on the wire, Decimal in the database

    def test_page_size_and_search(self):
        r = self.client_as("admin").get("/api/products/?page_size=1&search=tea")
        self.assertEqual(r.json()["count"], 1)
        self.assertEqual(r.json()["results"][0]["sku"], "SKU-2")

    def test_create_product_as_admin(self):
        r = self.client_as("admin").post("/api/products/", self.product_payload())
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(Product.objects.get(sku="NEW-1").selling_price, Decimal("14.00"))

    def test_view_only_role_cannot_write(self):
        self.assertEqual(self.client_as("accounts").post("/api/products/", self.product_payload()).status_code, 403)
        self.assertEqual(self.client_as("warehouse").delete(f"/api/products/{self.product.pk}/").status_code, 403)

    def test_duplicate_sku_is_a_clear_400(self):
        r = self.client_as("admin").post("/api/products/", self.product_payload(sku="sku-1"))
        self.assertEqual(r.status_code, 400)
        self.assertIn("already exists", r.json()["message"])

    def test_subcategory_must_belong_to_category(self):
        other_top = Category.objects.create(name="Beverages")
        sub = Category.objects.create(name="Juices", parent=other_top)
        r = self.client_as("admin").post("/api/products/", self.product_payload(subcategoryId=sub.pk))
        self.assertEqual(r.status_code, 400)
        ok = self.client_as("admin").post("/api/products/", self.product_payload(categoryId=other_top.pk, subcategoryId=sub.pk))
        self.assertEqual(ok.status_code, 201, ok.content)

    def test_invalid_numbers_rejected(self):
        a = self.client_as("admin")
        self.assertEqual(a.post("/api/products/", self.product_payload(sellingPrice="-1")).status_code, 400)
        self.assertEqual(a.post("/api/products/", self.product_payload(gstRate="101")).status_code, 400)
        self.assertEqual(a.post("/api/products/", self.product_payload(packSize=0)).status_code, 400)

    def test_delete_referenced_brand_is_409_with_reason(self):
        r = self.client_as("admin").delete(f"/api/brands/{self.product.brand_id}/")
        self.assertEqual(r.status_code, 409)
        self.assertIn("used by 2 products", r.json()["message"])
        self.assertTrue(Brand.objects.filter(pk=self.product.brand_id).exists())

    def test_delete_unused_brand_and_audit(self):
        b = Brand.objects.create(name="Spare")
        self.assertEqual(self.client_as("admin").delete(f"/api/brands/{b.pk}/").status_code, 204)
        from apps.core.models import AuditLog

        self.assertTrue(AuditLog.objects.filter(entity_type="Brand", action="delete", entity_ref="Spare").exists())

    def test_product_with_stock_cannot_be_deleted(self):
        self.make_batch()
        r = self.client_as("admin").delete(f"/api/products/{self.product.pk}/")
        self.assertEqual(r.status_code, 409)

    def test_category_rules(self):
        a = self.client_as("admin")
        top = self.product.category
        sub = a.post("/api/categories/", {"name": "Namkeen", "parentId": top.pk, "active": True})
        self.assertEqual(sub.status_code, 201, sub.content)
        nested = a.post("/api/categories/", {"name": "Deep", "parentId": sub.json()["id"], "active": True})
        self.assertEqual(nested.status_code, 400)
        dup = a.post("/api/categories/", {"name": "namkeen", "parentId": top.pk, "active": True})
        self.assertEqual(dup.status_code, 400)

    def test_unit_conversion_validation(self):
        a = self.client_as("admin")
        u, b = self.product.unit_id, self.product.pack_unit_id
        self.assertEqual(a.post("/api/unit-conversions/", {"fromUnitId": u, "toUnitId": u, "factor": 2}).status_code, 400)
        self.assertEqual(a.post("/api/unit-conversions/", {"fromUnitId": b, "toUnitId": u, "factor": 0}).status_code, 400)
        self.assertEqual(a.post("/api/unit-conversions/", {"fromUnitId": b, "toUnitId": u, "factor": 12}).status_code, 201)
        self.assertEqual(a.post("/api/unit-conversions/", {"fromUnitId": b, "toUnitId": u, "factor": 6}).status_code, 400)
