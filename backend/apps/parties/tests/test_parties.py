from decimal import Decimal

from django.db import IntegrityError, transaction

from apps.core.testing import ERPTestCase
from apps.parties.models import Distributor, DistributorPrice, Supplier


class PartiesModelTests(ERPTestCase):
    def test_distributor_code_unique(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Distributor.objects.create(code="D001", name="Other", state="Kerala")

    def test_one_price_per_distributor_and_product(self):
        DistributorPrice.objects.create(distributor=self.dist_local, product=self.product, price=Decimal("14"))
        with self.assertRaises(IntegrityError), transaction.atomic():
            DistributorPrice.objects.create(distributor=self.dist_local, product=self.product, price=Decimal("13"))


class PartiesApiTests(ERPTestCase):
    def distributor_body(self, **over):
        body = {"name": "New Dealer", "type": "dealer", "state": "Kerala", "creditLimit": "50000", "creditDays": 15, "active": True}
        body.update(over)
        return body

    def test_distributor_code_is_generated(self):
        r = self.client_as("sales").post("/api/distributors/", self.distributor_body())
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["code"], "D003")
        r2 = self.client_as("sales").post("/api/distributors/", self.distributor_body(name="Another"))
        self.assertEqual(r2.json()["code"], "D004")

    def test_gstin_validation(self):
        bad = self.client_as("admin").post("/api/distributors/", self.distributor_body(gstin="NOT-A-GSTIN"))
        self.assertEqual(bad.status_code, 400)
        ok = self.client_as("admin").post("/api/distributors/", self.distributor_body(gstin="29aabcr4521f1z5"))
        self.assertEqual(ok.status_code, 201, ok.content)
        self.assertEqual(ok.json()["gstin"], "29AABCR4521F1Z5")

    def test_duplicate_distributor_name_and_negative_credit_limit(self):
        self.assertEqual(self.client_as("admin").post("/api/distributors/", self.distributor_body(name="local traders")).status_code, 400)
        self.assertEqual(self.client_as("admin").post("/api/distributors/", self.distributor_body(creditLimit="-5")).status_code, 400)

    def test_distributor_permissions(self):
        # warehouse and accounts may only view distributors; sales may edit them
        self.assertEqual(self.client_as("warehouse").get("/api/distributors/").status_code, 200)
        self.assertEqual(self.client_as("warehouse").post("/api/distributors/", self.distributor_body()).status_code, 403)
        self.assertEqual(self.client_as(None).get("/api/distributors/").status_code in (401, 403), True)

    def test_supplier_requires_purchases_access(self):
        self.assertEqual(self.client_as("sales").get("/api/suppliers/").status_code, 403)
        body = {"name": "Fresh Foods", "state": "Karnataka", "gstin": "29AABCF1234F1Z5"}
        self.assertEqual(self.client_as("warehouse").post("/api/suppliers/", body).status_code, 201)
        self.assertEqual(self.client_as("warehouse").post("/api/suppliers/", body).status_code, 400)

    def test_delete_supplier_with_orders_is_409(self):
        self.make_batch()  # batch references the supplier
        r = self.client_as("admin").delete(f"/api/suppliers/{self.supplier.pk}/")
        self.assertEqual(r.status_code, 409)
        self.assertTrue(Supplier.objects.filter(pk=self.supplier.pk).exists())

    def test_price_uniqueness_and_ranges(self):
        a = self.client_as("sales")
        body = {"distributorId": self.dist_local.pk, "productId": self.product.pk, "price": "14", "discountPct": "3", "terms": "3% trade discount"}
        r = a.post("/api/distributor-prices/", body)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["discountPct"], 3)
        self.assertEqual(a.post("/api/distributor-prices/", body).status_code, 400)
        self.assertEqual(a.post("/api/distributor-prices/", {**body, "productId": self.product2.pk, "discountPct": "120"}).status_code, 400)
        listing = a.get(f"/api/distributor-prices/?distributor={self.dist_local.pk}").json()
        self.assertEqual(listing["count"], 1)
