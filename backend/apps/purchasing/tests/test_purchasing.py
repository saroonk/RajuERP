from datetime import timedelta
from decimal import Decimal

from apps.core.testing import TODAY, ERPTestCase
from apps.inventory.models import Batch, StockMovement
from apps.inventory.stock import bucket_qty
from apps.purchasing.models import GoodsReceipt, PurchaseOrder


class PurchasingBase(ERPTestCase):
    def create_po(self, status="ordered", lines=None, role="warehouse"):
        lines = lines or [
            {"productId": self.product.pk, "qty": 100, "rate": "10.00", "gstRate": "18"},
            {"productId": self.product2.pk, "qty": 50, "rate": "80.00", "gstRate": "5"},
        ]
        r = self.client_as(role).post(
            "/api/purchasing/orders/",
            {"supplierId": self.supplier.pk, "date": str(TODAY), "expectedDate": str(TODAY + timedelta(days=7)), "lines": lines, "notes": "", "status": status},
        )
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def grn_body(self, po_id, lines, **over):
        body = {"poId": po_id, "date": str(TODAY), "supplierInvoiceNo": "SI-1", "lines": lines}
        body.update(over)
        return body

    def grn_line(self, product, qty, batch_no, days_to_expiry=300, mfg_days_ago=10):
        return {
            "productId": product.pk, "batchNo": batch_no, "mfgDate": str(TODAY - timedelta(days=mfg_days_ago)),
            "expiryDate": str(TODAY + timedelta(days=days_to_expiry)), "qty": qty,
        }


class PurchaseOrderTests(PurchasingBase):
    def test_create_computes_totals_and_number(self):
        po = self.create_po()
        self.assertTrue(po["poNo"].startswith(f"PO-{TODAY.year}-"))
        self.assertEqual(po["supplierName"], "Supplier One")
        # 100 x 10 @18% + 50 x 80 @5%
        self.assertEqual((po["taxable"], po["tax"], po["total"]), (5000, 380, 5380))
        self.assertEqual(po["receivedPct"], 0)
        self.assertEqual([p["pending"] for p in po["lineProgress"]], [100, 50])

    def test_po_numbers_are_sequential_and_unique(self):
        a, b = self.create_po(), self.create_po()
        self.assertNotEqual(a["poNo"], b["poNo"])
        self.assertEqual(int(b["poNo"].split("-")[-1]), int(a["poNo"].split("-")[-1]) + 1)

    def test_validation(self):
        c = self.client_as("warehouse")
        base = {"supplierId": self.supplier.pk, "date": str(TODAY), "status": "draft", "notes": ""}
        dup = [{"productId": self.product.pk, "qty": 1, "rate": "5", "gstRate": "5"}] * 2
        self.assertEqual(c.post("/api/purchasing/orders/", {**base, "lines": dup}).status_code, 400)
        self.assertEqual(c.post("/api/purchasing/orders/", {**base, "lines": []}).status_code, 400)
        zero = [{"productId": self.product.pk, "qty": 0, "rate": "5", "gstRate": "5"}]
        self.assertEqual(c.post("/api/purchasing/orders/", {**base, "lines": zero}).status_code, 400)
        self.assertEqual(c.post("/api/purchasing/orders/", {**base, "status": "received", "lines": [{"productId": self.product.pk, "qty": 1, "rate": "5", "gstRate": "5"}]}).status_code, 400)

    def test_permissions(self):
        self.assertIn(self.client_as(None).get("/api/purchasing/orders/").status_code, (401, 403))
        self.assertEqual(self.client_as("sales").get("/api/purchasing/orders/").status_code, 403)
        self.assertEqual(self.client_as("accounts").get("/api/purchasing/orders/").status_code, 200)  # view only
        self.assertEqual(self.client_as("accounts").post("/api/purchasing/orders/", {}).status_code, 403)

    def test_status_transitions_edit_and_delete_rules(self):
        c = self.client_as("warehouse")
        po = self.create_po(status="draft")
        self.assertEqual(c.post(f"/api/purchasing/orders/{po['id']}/set-status/", {"status": "ordered"}).json()["status"], "ordered")
        self.assertEqual(c.post(f"/api/purchasing/orders/{po['id']}/set-status/", {"status": "ordered"}).status_code, 409)
        self.assertEqual(c.delete(f"/api/purchasing/orders/{po['id']}/").status_code, 409)  # ordered POs cannot be deleted
        self.assertEqual(c.post(f"/api/purchasing/orders/{po['id']}/set-status/", {"status": "cancelled"}).json()["status"], "cancelled")
        self.assertEqual(c.delete(f"/api/purchasing/orders/{po['id']}/").status_code, 204)

    def test_edit_replaces_lines_but_not_after_receipt(self):
        c = self.client_as("warehouse")
        po = self.create_po()
        body = {
            "supplierId": self.supplier.pk, "date": str(TODAY), "expectedDate": None, "notes": "edited", "status": "ordered",
            "lines": [{"productId": self.product.pk, "qty": 10, "rate": "11.00", "gstRate": "18"}],
        }
        r = c.put(f"/api/purchasing/orders/{po['id']}/", body)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((len(r.json()["lines"]), r.json()["notes"]), (1, "edited"))
        g = c.post("/api/purchasing/receipts/", self.grn_body(po["id"], [self.grn_line(self.product, 10, "B1")]))
        self.assertEqual(g.status_code, 201, g.content)
        self.assertEqual(c.put(f"/api/purchasing/orders/{po['id']}/", body).status_code, 409)


class GoodsReceiptTests(PurchasingBase):
    def test_receipt_creates_batch_stock_movement_and_updates_po(self):
        po = self.create_po()
        c = self.client_as("warehouse")
        r = c.post("/api/purchasing/receipts/", self.grn_body(po["id"], [self.grn_line(self.product, 100, "BATCH-A"), self.grn_line(self.product2, 20, "BATCH-T")]))
        self.assertEqual(r.status_code, 201, r.content)
        grn = r.json()
        self.assertTrue(grn["grnNo"].startswith("GRN-"))
        self.assertEqual((grn["taxable"], grn["tax"], grn["total"]), (2600, 260, 2860))  # 100x10@18% + 20x80@5%
        a = Batch.objects.get(batch_no="BATCH-A")
        self.assertEqual((a.received_qty, a.cost_price, a.supplier_id, a.receipt_id), (100, Decimal("10.00"), self.supplier.pk, grn["id"]))
        self.assertEqual(bucket_qty(a.pk, "saleable"), 100)
        self.assertTrue(StockMovement.objects.filter(type="receipt", ref_no=grn["grnNo"], qty=100).exists())
        po_after = c.get(f"/api/purchasing/orders/{po['id']}/").json()
        self.assertEqual(po_after["status"], "partial")  # product2 only 20 of 50
        self.assertEqual({p["productId"]: p["pending"] for p in po_after["lineProgress"]}, {self.product.pk: 0, self.product2.pk: 30})
        self.assertEqual(po_after["receivedPct"], 80)
        # second receipt completes the PO
        r2 = c.post("/api/purchasing/receipts/", self.grn_body(po["id"], [self.grn_line(self.product2, 30, "BATCH-T2")]))
        self.assertEqual(r2.status_code, 201, r2.content)
        self.assertEqual(c.get(f"/api/purchasing/orders/{po['id']}/").json()["status"], "received")
        self.assertEqual(c.post("/api/purchasing/receipts/", self.grn_body(po["id"], [self.grn_line(self.product, 1, "X")])).status_code, 409)

    def test_over_receipt_rejected(self):
        po = self.create_po()
        r = self.client_as("warehouse").post("/api/purchasing/receipts/", self.grn_body(po["id"], [self.grn_line(self.product, 101, "BATCH-A")]))
        self.assertEqual(r.status_code, 400)
        self.assertIn("exceeds the pending quantity (100)", r.json()["message"])
        self.assertEqual(GoodsReceipt.objects.count(), 0)

    def test_failure_on_later_line_rolls_back_everything(self):
        po = self.create_po()
        lines = [self.grn_line(self.product, 100, "BATCH-A"), self.grn_line(self.product2, 51, "BATCH-T")]  # second exceeds pending 50
        r = self.client_as("warehouse").post("/api/purchasing/receipts/", self.grn_body(po["id"], lines))
        self.assertEqual(r.status_code, 400)
        self.assertEqual(Batch.objects.count(), 0)  # BATCH-A was created inside the transaction and rolled back
        self.assertEqual(StockMovement.objects.count(), 0)
        self.assertEqual(GoodsReceipt.objects.count(), 0)
        self.assertEqual(PurchaseOrder.objects.get(pk=po["id"]).status, "ordered")

    def test_date_and_batch_rules(self):
        po = self.create_po()
        c = self.client_as("warehouse")
        bad_exp = self.grn_line(self.product, 10, "B", days_to_expiry=-1)
        self.assertIn("already expired", c.post("/api/purchasing/receipts/", self.grn_body(po["id"], [bad_exp])).json()["message"])
        inverted = {**self.grn_line(self.product, 10, "B"), "mfgDate": str(TODAY + timedelta(days=400))}
        self.assertIn("after the manufacturing date", c.post("/api/purchasing/receipts/", self.grn_body(po["id"], [inverted])).json()["message"])
        blank = self.grn_line(self.product, 10, "   ")
        self.assertEqual(c.post("/api/purchasing/receipts/", self.grn_body(po["id"], [blank])).status_code, 400)
        not_on_po = self.client_as("warehouse").post(
            "/api/purchasing/receipts/", self.grn_body(po["id"], [self.grn_line(self.product, 1, "Z")])
        )
        self.assertEqual(not_on_po.status_code, 201)

    def test_same_batch_number_reuses_batch_only_with_same_expiry(self):
        po = self.create_po()
        c = self.client_as("warehouse")
        c.post("/api/purchasing/receipts/", self.grn_body(po["id"], [self.grn_line(self.product, 40, "SHARED")]))
        again = c.post("/api/purchasing/receipts/", self.grn_body(po["id"], [self.grn_line(self.product, 20, "SHARED")]))
        self.assertEqual(again.status_code, 201, again.content)
        b = Batch.objects.get(batch_no="SHARED")
        self.assertEqual((b.received_qty, bucket_qty(b.pk, "saleable")), (60, 60))
        self.assertEqual(Batch.objects.filter(batch_no="SHARED").count(), 1)
        diff = c.post("/api/purchasing/receipts/", self.grn_body(po["id"], [self.grn_line(self.product, 10, "SHARED", days_to_expiry=100)]))
        self.assertEqual(diff.status_code, 400)
        self.assertIn("different expiry date", diff.json()["message"])

    def test_receiving_needs_purchases_edit_permission(self):
        po = self.create_po()
        body = self.grn_body(po["id"], [self.grn_line(self.product, 10, "B")])
        self.assertEqual(self.client_as("sales").post("/api/purchasing/receipts/", body).status_code, 403)
        self.assertEqual(self.client_as("accounts").post("/api/purchasing/receipts/", body).status_code, 403)
        self.assertIn(self.client_as(None).post("/api/purchasing/receipts/", body).status_code, (401, 403))
        self.assertEqual(Batch.objects.count(), 0)
        self.assertEqual(self.client_as("warehouse").post("/api/purchasing/receipts/", body).status_code, 201)

    def test_draft_po_cannot_be_received(self):
        po = self.create_po(status="draft")
        r = self.client_as("warehouse").post("/api/purchasing/receipts/", self.grn_body(po["id"], [self.grn_line(self.product, 10, "B")]))
        self.assertEqual(r.status_code, 409)

    def test_receipt_list_and_detail(self):
        po = self.create_po()
        c = self.client_as("warehouse")
        grn = c.post("/api/purchasing/receipts/", self.grn_body(po["id"], [self.grn_line(self.product, 10, "B")])).json()
        listing = c.get("/api/purchasing/receipts/").json()
        self.assertEqual((listing["count"], listing["results"][0]["poNo"], listing["results"][0]["supplierName"]), (1, po["poNo"], "Supplier One"))
        self.assertEqual(c.get(f"/api/purchasing/receipts/{grn['id']}/").json()["lines"][0]["batchNo"], "B")


class SupplierReturnAndPaymentTests(PurchasingBase):
    def receive(self, qty=100):
        po = self.create_po(lines=[{"productId": self.product.pk, "qty": qty, "rate": "10.00", "gstRate": "18"}])
        r = self.client_as("warehouse").post("/api/purchasing/receipts/", self.grn_body(po["id"], [self.grn_line(self.product, qty, "RB")]))
        self.assertEqual(r.status_code, 201, r.content)
        return Batch.objects.get(batch_no="RB"), r.json()

    def outstanding(self):
        rows = self.client_as("accounts").get("/api/purchasing/outstanding/").json()["results"]
        return next(r for r in rows if r["supplierId"] == self.supplier.pk)

    def test_return_reduces_stock_and_supplier_balance(self):
        batch, grn = self.receive(100)
        self.assertEqual(self.outstanding()["outstanding"], 1180)  # 1000 + 18%
        c = self.client_as("warehouse")
        r = c.post("/api/purchasing/returns/", {"supplierId": self.supplier.pk, "date": str(TODAY), "reason": "Short shelf life", "lines": [{"batchId": batch.pk, "bucket": "saleable", "qty": 10}]})
        self.assertEqual(r.status_code, 201, r.content)
        ret = r.json()
        self.assertEqual((ret["taxable"], ret["tax"], ret["total"]), (100, 18, 118))
        self.assertEqual(ret["lines"][0]["rate"], 10)  # at batch cost
        self.assertEqual(bucket_qty(batch.pk, "saleable"), 90)
        o = self.outstanding()
        self.assertEqual((o["purchases"], o["returns"], o["outstanding"]), (1180, 118, 1062))

    def test_return_validations(self):
        batch, _ = self.receive(100)
        c = self.client_as("warehouse")
        base = {"supplierId": self.supplier.pk, "date": str(TODAY), "reason": ""}
        self.assertEqual(c.post("/api/purchasing/returns/", {**base, "lines": [{"batchId": batch.pk, "bucket": "saleable", "qty": 101}]}).status_code, 400)
        self.assertEqual(c.post("/api/purchasing/returns/", {**base, "lines": [{"batchId": batch.pk, "bucket": "damaged", "qty": 1}]}).status_code, 400)
        self.assertEqual(c.post("/api/purchasing/returns/", {**base, "lines": []}).status_code, 400)
        from apps.parties.models import Supplier

        other = Supplier.objects.create(name="Other", state="Karnataka")
        wrong = c.post("/api/purchasing/returns/", {**base, "supplierId": other.pk, "lines": [{"batchId": batch.pk, "bucket": "saleable", "qty": 1}]})
        self.assertEqual(wrong.status_code, 400)
        self.assertIn("not supplied by this supplier", wrong.json()["message"])
        self.assertEqual(bucket_qty(batch.pk, "saleable"), 100)

    def test_payments_and_outstanding(self):
        self.receive(100)
        c = self.client_as("accounts")
        r = c.post("/api/purchasing/payments/", {"supplierId": self.supplier.pk, "date": str(TODAY), "amount": "500.50", "mode": "bank_transfer", "reference": "UTR1"})
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["amount"], 500.5)
        o = self.outstanding()
        self.assertEqual((o["paid"], o["outstanding"], o["lastPaymentDate"]), (500.5, 679.5, str(TODAY)))
        self.assertEqual(c.post("/api/purchasing/payments/", {"supplierId": self.supplier.pk, "date": str(TODAY), "amount": "0", "mode": "cash"}).status_code, 400)
        self.assertEqual(c.post("/api/purchasing/payments/", {"supplierId": self.supplier.pk, "date": str(TODAY), "amount": "5", "mode": "barter"}).status_code, 400)
        self.assertEqual(c.get("/api/purchasing/payments/").json()["count"], 1)

    def test_payables_permissions(self):
        self.assertEqual(self.client_as("warehouse").get("/api/purchasing/outstanding/").status_code, 403)
        self.assertEqual(self.client_as("sales").post("/api/purchasing/payments/", {}).status_code, 403)
        self.assertEqual(self.client_as("accounts").get("/api/purchasing/outstanding/").status_code, 200)
