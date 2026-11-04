from datetime import date, timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction

from apps.core.models import AuditLog
from apps.core.testing import TODAY, ERPTestCase
from apps.inventory.models import Batch, StockMovement
from apps.inventory.stock import bucket_qty, post_movement
from apps.inventory.valuation import CostLayer, value_stock


class BatchModelTests(ERPTestCase):
    def test_batch_number_unique_per_product_but_not_across_products(self):
        self.make_batch(batch_no="B-1")
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.make_batch(batch_no="B-1")
        self.make_batch(product=self.product2, batch_no="B-1")  # same number, other product: fine

    def test_expiry_must_follow_manufacture_date(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Batch.objects.create(
                product=self.product, batch_no="BAD", mfg_date=TODAY, expiry_date=TODAY, received_qty=1, cost_price=1,
                supplier=self.supplier, received_on=TODAY,
            )

    def test_stock_cannot_go_negative(self):
        b = self.make_batch(qty=10)
        from apps.core.exceptions import DomainError

        with self.assertRaises(DomainError):
            post_movement(user=None, date=TODAY, batch=b, type="dispatch", bucket="saleable", qty=-11, ref_type="T", ref_id=None, ref_no="T")
        self.assertEqual(bucket_qty(b.pk, "saleable"), 10)


class ValuationTests(ERPTestCase):
    layers = [CostLayer(100, Decimal("10"), date(2026, 1, 1)), CostLayer(100, Decimal("20"), date(2026, 2, 1))]

    def test_fifo_costs_remaining_stock_from_newest_layers(self):
        self.assertEqual(value_stock("fifo", 100, self.layers), (Decimal("20.00"), Decimal("2000.00")))
        self.assertEqual(value_stock("fifo", 150, self.layers)[1], Decimal("2500.00"))

    def test_weighted_average(self):
        self.assertEqual(value_stock("weighted_average", 100, self.layers), (Decimal("15.00"), Decimal("1500.00")))

    def test_api_returns_both_methods(self):
        self.make_batch(batch_no="OLD", qty=100, cost=Decimal("10"), received_on=TODAY - timedelta(days=60))
        self.make_batch(batch_no="NEW", qty=100, cost=Decimal("20"), received_on=TODAY - timedelta(days=5))
        # sell 100 so 100 remain
        old = Batch.objects.get(batch_no="OLD")
        post_movement(user=None, date=TODAY, batch=old, type="dispatch", bucket="saleable", qty=-100, ref_type="T", ref_id=None, ref_no="T")
        c = self.client_as("accounts")
        fifo = {r["sku"]: r for r in c.get("/api/inventory/valuation/?method=fifo").json()["results"]}
        wavg = {r["sku"]: r for r in c.get("/api/inventory/valuation/?method=weighted_average").json()["results"]}
        self.assertEqual((fifo["SKU-1"]["qty"], fifo["SKU-1"]["value"]), (100, 2000))
        self.assertEqual(wavg["SKU-1"]["value"], 1500)
        self.assertEqual(c.get("/api/inventory/valuation/?method=lifo").status_code, 400)


class InventoryApiTests(ERPTestCase):
    def test_permissions(self):
        self.assertIn(self.client_as(None).get("/api/inventory/batches/").status_code, (401, 403))
        self.assertEqual(self.client_as("sales").get("/api/inventory/batches/").status_code, 200)  # sales may view stock
        b = self.make_batch()
        body = {"date": str(TODAY), "reason": "Damaged", "lines": [{"batchId": b.pk, "bucket": "saleable", "qty": 1}]}
        self.assertEqual(self.client_as("sales").post("/api/inventory/write-offs/", body).status_code, 403)
        self.assertEqual(self.client_as("accounts").post("/api/inventory/write-offs/", body).status_code, 403)
        self.assertEqual(self.client_as("warehouse").post("/api/inventory/write-offs/", body).status_code, 201)

    def test_batch_rows_have_bucket_quantities_and_expiry_status(self):
        self.make_batch(batch_no="SOON", qty=50, days_to_expiry=20)
        self.make_batch(batch_no="LATER", qty=30, days_to_expiry=400)
        rows = {r["batchNo"]: r for r in self.client_as("warehouse").get("/api/inventory/batches/").json()["results"]}
        self.assertEqual(rows["SOON"]["expiryStatus"], "critical")
        self.assertEqual(rows["LATER"]["expiryStatus"], "ok")
        self.assertEqual((rows["SOON"]["saleable"], rows["SOON"]["onHand"], rows["SOON"]["available"]), (50, 50, 50))
        detail = self.client_as("warehouse").get(f"/api/inventory/batches/{rows['SOON']['id']}/").json()
        self.assertEqual(detail["costPrice"], 10)

    def test_stock_by_product_flags_low_stock(self):
        self.make_batch(qty=10)  # min stock is 20
        rows = {r["sku"]: r for r in self.client_as("warehouse").get("/api/inventory/stock-by-product/").json()["results"]}
        self.assertEqual(rows["SKU-1"]["stockStatus"], "low")
        self.assertEqual(rows["SKU-2"]["stockStatus"], "out")
        self.assertEqual(rows["SKU-1"]["value"], 100)

    def test_expired_batch_is_not_available(self):
        self.make_batch(qty=40, days_to_expiry=-3, batch_no="OLD")
        row = self.client_as("warehouse").get("/api/inventory/batches/").json()["results"][0]
        self.assertEqual((row["expiryStatus"], row["saleable"], row["available"]), ("expired", 40, 0))
        alerts = self.client_as("warehouse").get("/api/inventory/alerts/").json()
        self.assertEqual(len(alerts["expired"]), 1)

    def test_movements_are_filterable_and_read_only(self):
        a = self.make_batch(batch_no="A")
        self.make_batch(batch_no="B", product=self.product2)
        c = self.client_as("warehouse")
        r = c.get(f"/api/inventory/movements/?batch={a.pk}").json()
        self.assertEqual(r["count"], 1)
        self.assertEqual(r["results"][0]["batchNo"], "A")
        self.assertEqual(c.post("/api/inventory/movements/", {}).status_code, 405)
        self.assertEqual(c.get("/api/inventory/movements/?type=receipt&bucket=saleable").json()["count"], 2)

    def test_suggest_allocation_uses_earliest_expiry_first(self):
        late = self.make_batch(batch_no="LATE", qty=100, days_to_expiry=300)
        early = self.make_batch(batch_no="EARLY", qty=30, days_to_expiry=60)
        c = self.client_as("warehouse")
        r = c.get(f"/api/inventory/suggest-allocation/?productId={self.product.pk}&qty=50&date={TODAY}").json()
        self.assertEqual([(x["batchNo"], x["qty"]) for x in r], [("EARLY", 30), ("LATE", 20)])
        r2 = c.get(f"/api/inventory/suggest-allocation/?productId={self.product.pk}&qty=50&date={TODAY}&exclude={early.pk}:30").json()
        self.assertEqual([(x["batchNo"], x["qty"]) for x in r2], [("LATE", 50)])
        self.assertEqual(c.get("/api/inventory/suggest-allocation/?qty=5").status_code, 400)
        batches = c.get(f"/api/inventory/dispatchable-batches/?productId={self.product.pk}&date={TODAY}").json()["results"]
        self.assertEqual([b["batchNo"] for b in batches], ["EARLY", "LATE"])
        self.assertEqual(late.pk, batches[1]["id"])

    # ----------------------------- write-offs -----------------------------

    def test_write_off_beyond_stock_is_rejected_and_changes_nothing(self):
        b = self.make_batch(qty=10)
        before = StockMovement.objects.count()
        r = self.client_as("warehouse").post(
            "/api/inventory/write-offs/", {"date": str(TODAY), "reason": "Expired", "lines": [{"batchId": b.pk, "bucket": "saleable", "qty": 11}]}
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("exceeds the saleable stock", r.json()["message"])
        self.assertEqual(StockMovement.objects.count(), before)
        self.assertEqual(bucket_qty(b.pk, "saleable"), 10)

    def test_write_off_posts_movement_value_and_audit(self):
        b = self.make_batch(qty=10, cost=Decimal("12.50"))
        r = self.client_as("warehouse").post(
            "/api/inventory/write-offs/", {"date": str(TODAY), "reason": "Expired stock disposal", "lines": [{"batchId": b.pk, "bucket": "saleable", "qty": 4}]}
        )
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        self.assertEqual((body["totalValue"], body["lineCount"], body["totalQty"]), (50, 1, 4))
        self.assertTrue(body["writeOffNo"].startswith("WO-"))
        self.assertEqual(bucket_qty(b.pk, "saleable"), 6)
        self.assertTrue(StockMovement.objects.filter(type="write_off", qty=-4, ref_no=body["writeOffNo"]).exists())
        self.assertTrue(AuditLog.objects.filter(entity_type="Write-off").exists())
        self.assertEqual(self.client_as("warehouse").get("/api/inventory/write-offs/").json()["count"], 1)

    def test_write_off_requires_reason_and_lines(self):
        b = self.make_batch()
        c = self.client_as("warehouse")
        self.assertEqual(c.post("/api/inventory/write-offs/", {"date": str(TODAY), "reason": "  ", "lines": [{"batchId": b.pk, "bucket": "saleable", "qty": 1}]}).status_code, 400)
        self.assertEqual(c.post("/api/inventory/write-offs/", {"date": str(TODAY), "reason": "x", "lines": []}).status_code, 400)

    def test_two_lines_on_same_batch_are_summed_against_stock(self):
        b = self.make_batch(qty=10)
        lines = [{"batchId": b.pk, "bucket": "saleable", "qty": 6}, {"batchId": b.pk, "bucket": "saleable", "qty": 6}]
        r = self.client_as("warehouse").post("/api/inventory/write-offs/", {"date": str(TODAY), "reason": "x", "lines": lines})
        self.assertEqual(r.status_code, 400)

    # --------------------------- reconciliation ---------------------------

    def test_reconciliation_approval_posts_adjustment(self):
        b = self.make_batch(qty=100)
        c = self.client_as("warehouse")
        r = c.post("/api/inventory/reconciliations/", {"date": str(TODAY), "notes": "Cycle count", "lines": [{"batchId": b.pk, "physicalQty": 97}]})
        self.assertEqual(r.status_code, 201, r.content)
        rec = r.json()
        self.assertEqual((rec["status"], rec["lines"][0]["systemQty"], rec["totalVariance"]), ("draft", 100, -3))
        self.assertEqual(bucket_qty(b.pk, "saleable"), 100)  # a draft changes nothing
        ap = c.post(f"/api/inventory/reconciliations/{rec['id']}/approve/")
        self.assertEqual(ap.status_code, 200, ap.content)
        self.assertEqual((ap.json()["status"], ap.json()["lines"][0]["appliedDiff"]), ("approved", -3))
        self.assertEqual(bucket_qty(b.pk, "saleable"), 97)
        self.assertTrue(StockMovement.objects.filter(type="adjustment", qty=-3).exists())
        again = c.post(f"/api/inventory/reconciliations/{rec['id']}/approve/")
        self.assertEqual(again.status_code, 400)
        self.assertEqual(c.delete(f"/api/inventory/reconciliations/{rec['id']}/").status_code, 409)

    def test_reconciliation_approval_uses_stock_at_approval_time(self):
        b = self.make_batch(qty=100)
        c = self.client_as("warehouse")
        rec = c.post("/api/inventory/reconciliations/", {"date": str(TODAY), "lines": [{"batchId": b.pk, "physicalQty": 100}]}).json()
        post_movement(user=None, date=TODAY, batch=b, type="dispatch", bucket="saleable", qty=-10, ref_type="T", ref_id=None, ref_no="T")
        ap = c.post(f"/api/inventory/reconciliations/{rec['id']}/approve/").json()
        self.assertEqual(ap["lines"][0]["appliedDiff"], 10)
        self.assertEqual(bucket_qty(b.pk, "saleable"), 100)

    def test_draft_reconciliation_can_be_deleted_and_duplicates_rejected(self):
        b = self.make_batch()
        c = self.client_as("warehouse")
        dup = c.post("/api/inventory/reconciliations/", {"date": str(TODAY), "lines": [{"batchId": b.pk, "physicalQty": 1}, {"batchId": b.pk, "physicalQty": 2}]})
        self.assertEqual(dup.status_code, 400)
        rec = c.post("/api/inventory/reconciliations/", {"date": str(TODAY), "lines": [{"batchId": b.pk, "physicalQty": 5}]}).json()
        self.assertEqual(c.delete(f"/api/inventory/reconciliations/{rec['id']}/").status_code, 204)
        self.assertEqual(c.get("/api/inventory/reconciliations/").json()["count"], 0)


class AlertsIntegrationTests(ERPTestCase):
    def test_alert_summary_shape_and_total(self):
        self.make_batch(batch_no="SOON", qty=5, days_to_expiry=10)  # expiring + product low on stock
        body = self.client_as("sales").get("/api/inventory/alerts/").json()
        for key in ("expiring", "expired", "lowStock", "overdue", "overLimit", "pendingInspection", "total"):
            self.assertIn(key, body)
        self.assertEqual(len(body["expiring"]), 1)
        self.assertEqual({p["sku"] for p in body["lowStock"]}, {"SKU-1", "SKU-2"})
        self.assertEqual(body["total"], 3)
        self.assertEqual(self.client_as(None).get("/api/inventory/alerts/").status_code in (401, 403), True)
