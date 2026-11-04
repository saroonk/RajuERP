from decimal import Decimal

from apps.core.testing import TODAY, ERPTestCase
from apps.distribution.models import DistributorStockReport

from .test_orders_dispatch import DistributionTestMixin


class DistributorStockTests(DistributionTestMixin, ERPTestCase):
    def dispatch(self, qty=10):
        batch = self.make_batch(qty=100)
        order = self.make_order()
        r = self.client_as("warehouse").post(
            "/api/distribution/dispatches/", self.dispatch_payload(order["id"], [{"productId": self.product.pk, "batchId": batch.pk, "qty": qty}]), format="json"
        )
        self.assertEqual(r.status_code, 201, r.content)

    def stock(self):
        return self.client_as("sales").get("/api/distribution/stock/").json()["results"]

    def test_dispatched_quantity_is_not_counted_as_sales(self):
        self.dispatch(10)
        rows = self.stock()
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual((row["dispatched"], row["returnedToUs"]), (10, 0))
        self.assertIsNone(row["reportedSales"])
        self.assertIsNone(row["reportedRemaining"])
        self.assertIsNone(row["unreconciled"])

    def test_reported_figures_reconcile_against_dispatch(self):
        self.dispatch(10)
        body = {"distributorId": self.dist_local.pk, "productId": self.product.pk, "period": TODAY.strftime("%Y-%m"), "reportedSales": 6, "remainingStock": 3, "returned": 0}
        r = self.client_as("sales").post("/api/distribution/stock-reports/", body, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        row = self.stock()[0]
        self.assertEqual((row["reportedSales"], row["reportedRemaining"], row["unreconciled"]), (6, 3, 1))
        # Same distributor+product+period is updated, not duplicated.
        r = self.client_as("sales").post("/api/distribution/stock-reports/", {**body, "reportedSales": 7}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(DistributorStockReport.objects.count(), 1)
        self.assertEqual(self.stock()[0]["unreconciled"], 0)

    def test_report_validation(self):
        base = {"distributorId": self.dist_local.pk, "productId": self.product.pk, "period": "2026-01", "reportedSales": 1, "remainingStock": 1, "returned": 0}
        c = self.client_as("sales")
        self.assertEqual(c.post("/api/distribution/stock-reports/", {**base, "period": "2026-13"}, format="json").status_code, 400)
        self.assertEqual(c.post("/api/distribution/stock-reports/", {**base, "reportedSales": -1}, format="json").status_code, 400)
        self.assertEqual(c.post("/api/distribution/stock-reports/", {**base, "productId": 99999}, format="json").status_code, 400)

    def test_csv_import_reports_row_errors_and_keeps_valid_rows(self):
        rows = [
            ["distributorCode", "sku", "period", "reportedSales", "remainingStock", "returned"],
            ["D001", "SKU-1", "2026-02", "5", "2", "0"],
            ["NOPE", "SKU-1", "2026-02", "5", "2", "0"],
            ["D002", "SKU-2", "2026-02", "x", "2", "0"],
            ["D002", "SKU-2", "2026-02", "4", "1", ""],
        ]
        r = self.client_as("sales").post("/api/distribution/stock-reports/import/", {"rows": rows}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(body["imported"], 2)
        self.assertEqual([e["row"] for e in body["errors"]], [3, 4])
        self.assertEqual(DistributorStockReport.objects.filter(source="import").count(), 2)
        listing = self.client_as("sales").get("/api/distribution/stock-reports/").json()
        self.assertEqual(listing["count"], 2)
        self.assertEqual(listing["results"][0]["sku"] in ("SKU-1", "SKU-2"), True)

    def test_delete_report_and_permissions(self):
        rep = DistributorStockReport.objects.create(
            distributor=self.dist_local, product=self.product, period="2026-01", reported_sales=1, remaining_stock=1, reported_on=TODAY
        )
        self.assertEqual(self.client_as("accounts").delete(f"/api/distribution/stock-reports/{rep.pk}/").status_code, 403)
        self.assertEqual(self.client_as("sales").delete(f"/api/distribution/stock-reports/{rep.pk}/").status_code, 204)
        self.assertEqual(Decimal(DistributorStockReport.objects.count()), 0)
