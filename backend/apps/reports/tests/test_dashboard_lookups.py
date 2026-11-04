from datetime import timedelta
from decimal import Decimal

from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.core.testing import TODAY
from apps.finance.models import Payment, PaymentAllocation
from apps.finance.tests.base import FinanceTestCase


class DashboardTests(FinanceTestCase):
    def test_kpis_match_underlying_records(self):
        inv = self.make_invoice()  # 1180 this month, due in 30 days
        old = self.make_invoice(date=TODAY - timedelta(days=60))  # overdue
        pay = Payment.objects.create(receipt_no="RCT-T-70", distributor=self.dist_local, date=TODAY, amount=Decimal("400"), mode="cash")
        PaymentAllocation.objects.create(payment=pay, invoice=inv, amount=Decimal("400"))
        self.make_grn(taxable="500", tax="90")
        self.make_supplier_payment("100")
        self.make_batch(self.product, qty=50, batch_no="D-1", cost=Decimal("10"))  # in stock, within shelf life
        k = self.client_as("admin").get("/api/dashboard/").json()["kpis"]
        month_taxable = Decimal("1000") + (Decimal("1000") if old.date.month == TODAY.month else 0)
        self.assertEqual(self.dec(k["salesMonth"]), month_taxable)
        self.assertEqual(k["receivables"], 1180 + 1180 - 400)
        self.assertEqual(k["overdueReceivables"], 1180)
        self.assertEqual(k["collectionsMonth"], 400)
        self.assertEqual(k["purchasesMonth"], 500)
        self.assertEqual(k["payables"], 590 - 100)
        self.assertGreaterEqual(k["stockValue"], 500)
        self.assertEqual(k["openOrders"], 0)

    def test_open_orders_count_and_lists(self):
        from apps.distribution.models import DistributionOrder

        DistributionOrder.objects.create(order_no="ORD-T-900", distributor=self.dist_local, date=TODAY, status="confirmed")
        DistributionOrder.objects.create(order_no="ORD-T-901", distributor=self.dist_local, date=TODAY, status="partially_dispatched")
        DistributionOrder.objects.create(order_no="ORD-T-902", distributor=self.dist_local, date=TODAY, status="draft")
        self.make_invoice(date=TODAY - timedelta(days=60))
        d = self.client_as("admin").get("/api/dashboard/").json()
        self.assertEqual(d["kpis"]["openOrders"], 2)
        self.assertEqual(len(d["overdue"]), 1)
        self.assertEqual(d["overdue"][0]["daysOverdue"], 30)
        self.assertEqual(len(d["recentInvoices"]), 1)
        self.assertEqual(len(d["monthly"]), 6)
        self.assertEqual(d["monthly"][-1]["month"], TODAY.strftime("%Y-%m"))

    def test_expiry_and_low_stock_alerts_feed_the_dashboard(self):
        self.make_batch(self.product, qty=100, batch_no="EXP-SOON", days_to_expiry=10)
        self.make_batch(self.product2, qty=3, batch_no="LOW-1", days_to_expiry=300)  # below min_stock 10
        d = self.client_as("admin").get("/api/dashboard/").json()
        self.assertEqual(d["kpis"]["expiringBatches"], 1)
        self.assertEqual(d["kpis"]["lowStockProducts"], 1)
        self.assertEqual(d["expiringSoon"][0]["batchNo"], "EXP-SOON")
        self.assertEqual(d["lowStock"][0]["sku"], "SKU-2")

    def test_sales_by_brand_and_top_distributors(self):
        self.make_invoice()
        self.make_invoice(distributor=self.dist_other, qty=1, rate="50", gst="0")
        d = self.client_as("admin").get("/api/dashboard/").json()
        self.assertEqual(d["salesByBrand"], [{"name": "Test Brand", "value": 1050}])
        self.assertEqual(d["topDistributors"][0]["name"], "Local Traders")

    def test_query_count_does_not_grow_with_data(self):
        c = self.client_as("admin")
        self.make_invoice()
        with CaptureQueriesContext(connection) as few:
            self.assertEqual(c.get("/api/dashboard/").status_code, 200)
        for _ in range(8):
            self.make_invoice(distributor=self.dist_other, date=TODAY - timedelta(days=50))
        with CaptureQueriesContext(connection) as many:
            self.assertEqual(c.get("/api/dashboard/").status_code, 200)
        # recentInvoices/overdue rows are capped, so only a few extra queries are allowed regardless of data size.
        self.assertLessEqual(len(many) - len(few), 2)
        self.assertLess(len(many), 60)

    def test_permissions(self):
        self.assertEqual(self.client_as("warehouse").get("/api/dashboard/").status_code, 200)
        self.assertIn(self.client_as(None).get("/api/dashboard/").status_code, (401, 403))


class LookupsAndSearchTests(FinanceTestCase):
    def test_lookups_shape_for_any_signed_in_role(self):
        for role in ("admin", "accounts", "warehouse", "sales"):
            res = self.client_as(role).get("/api/lookups/")
            self.assertEqual(res.status_code, 200, role)
        body = self.client_as("warehouse").get("/api/lookups/").json()
        self.assertEqual(set(body), {"brands", "categories", "units", "products", "suppliers", "distributors", "expenseCategories"})
        p = next(x for x in body["products"] if x["sku"] == "SKU-1")
        for key in ("brandId", "categoryId", "subcategoryId", "unitId", "packUnitId", "packSize", "purchasePrice", "sellingPrice", "gstRate", "minStock"):
            self.assertIn(key, p)
        self.assertEqual(p["sellingPrice"], 15)
        self.assertEqual(p["gstRate"], 18)
        self.assertIn("creditLimit", body["distributors"][0])
        self.assertIn("parentId", body["categories"][0])
        self.assertIn(self.client_as(None).get("/api/lookups/").status_code, (401, 403))

    def test_lookups_is_read_only(self):
        self.assertEqual(self.client_as("admin").post("/api/lookups/", {}, format="json").status_code, 405)

    def test_search_requires_two_characters_and_returns_typed_results(self):
        c = self.client_as("admin")
        self.assertEqual(c.get("/api/search/?q=a").json(), [])
        inv = self.make_invoice()
        results = c.get("/api/search/?q=Local").json()
        types = {r["type"] for r in results}
        self.assertTrue({"Distributor", "Invoice"} <= types)
        invoice = next(r for r in results if r["type"] == "Invoice")
        self.assertEqual(invoice["href"], f"/sales/invoices/{inv.pk}")

    def test_search_hides_entities_from_modules_the_user_cannot_view(self):
        Payment.objects.create(receipt_no="RCT-T-80", distributor=self.dist_local, date=TODAY, amount=Decimal("10"), mode="cash", reference="UTR-SEARCH")
        accounts = {r["type"] for r in self.client_as("accounts").get("/api/search/?q=RCT-T-80").json()}
        warehouse = {r["type"] for r in self.client_as("warehouse").get("/api/search/?q=RCT-T-80").json()}
        self.assertIn("Payment", accounts)
        self.assertNotIn("Payment", warehouse)
        # warehouse has no 'sales'... it has view; but no receivables
        self.assertEqual(self.client_as("warehouse").get("/api/search/?q=SKU-1").json()[0]["type"], "Product")
