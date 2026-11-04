from datetime import timedelta
from decimal import Decimal

from apps.core.testing import TODAY, ERPTestCase
from apps.distribution.models import Dispatch, DistributionOrder
from apps.inventory.models import StockMovement
from apps.inventory.stock import bucket_qty


class DistributionTestMixin:
    def order_payload(self, distributor=None, lines=None, status="confirmed", **extra):
        distributor = distributor or self.dist_local
        lines = lines or [{"productId": self.product.pk, "qty": 10, "rate": "15.00", "discountPct": 0, "gstRate": 18}]
        return {"distributorId": distributor.pk, "date": str(TODAY), "expectedDate": None, "notes": "", "status": status, "lines": lines, **extra}

    def make_order(self, role="sales", **kw):
        r = self.client_as(role).post("/api/distribution/orders/", self.order_payload(**kw), format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def dispatch_payload(self, order_id, lines, **extra):
        return {"orderId": order_id, "date": str(TODAY), "vehicleNo": "KA-01", "deliveryRef": "DC-1", "notes": "", "lines": lines, **extra}


class OrderTests(DistributionTestMixin, ERPTestCase):
    def test_create_order_computes_totals_on_server(self):
        body = self.make_order(lines=[{"productId": self.product.pk, "qty": 10, "rate": "15.00", "discountPct": 0, "gstRate": 5}])
        # 10 x 15 = 150 taxable; the client sent 5% GST but the product is 18%, which the server uses.
        self.assertEqual(Decimal(str(body["taxable"])), Decimal("150.00"))
        self.assertEqual(Decimal(str(body["tax"])), Decimal("27.00"))
        self.assertEqual(Decimal(str(body["total"])), Decimal("177.00"))
        self.assertEqual(body["lines"][0]["gstRate"], 18)
        self.assertEqual(body["status"], "confirmed")
        self.assertEqual(body["lineProgress"][0]["pending"], 10)
        self.assertTrue(body["orderNo"].startswith("ORD-"))

    def test_duplicate_product_lines_rejected(self):
        line = {"productId": self.product.pk, "qty": 1, "rate": "15", "discountPct": 0, "gstRate": 18}
        r = self.client_as("sales").post("/api/distribution/orders/", self.order_payload(lines=[line, line]), format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("twice", r.json()["message"])
        self.assertEqual(DistributionOrder.objects.count(), 0)

    def test_invalid_quantity_rate_and_discount_rejected(self):
        for patch in ({"qty": 0}, {"qty": -3}, {"rate": "0"}, {"rate": "-1"}, {"discountPct": 101}):
            line = {"productId": self.product.pk, "qty": 5, "rate": "15", "discountPct": 0, **patch}
            r = self.client_as("sales").post("/api/distribution/orders/", self.order_payload(lines=[line]), format="json")
            self.assertEqual(r.status_code, 400, patch)

    def test_inactive_distributor_rejected(self):
        self.dist_local.active = False
        self.dist_local.save()
        r = self.client_as("sales").post("/api/distribution/orders/", self.order_payload(), format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("inactive", r.json()["message"])

    def test_confirm_cancel_delete_rules(self):
        c = self.client_as("sales")
        draft = self.make_order(status="draft")
        self.assertEqual(c.post(f"/api/distribution/orders/{draft['id']}/confirm/").json()["status"], "confirmed")
        self.assertEqual(c.post(f"/api/distribution/orders/{draft['id']}/confirm/").status_code, 400)  # not a draft any more
        self.assertEqual(c.delete(f"/api/distribution/orders/{draft['id']}/").status_code, 400)  # confirmed orders cannot be deleted
        self.assertEqual(c.post(f"/api/distribution/orders/{draft['id']}/cancel/").json()["status"], "cancelled")
        self.assertEqual(c.delete(f"/api/distribution/orders/{draft['id']}/").status_code, 204)
        self.assertFalse(DistributionOrder.objects.filter(pk=draft["id"]).exists())

    def test_update_replaces_lines_until_dispatched(self):
        c = self.client_as("sales")
        order = self.make_order(status="draft")
        payload = self.order_payload(lines=[{"productId": self.product2.pk, "qty": 4, "rate": "100", "discountPct": 5, "gstRate": 5}])
        r = c.put(f"/api/distribution/orders/{order['id']}/", payload, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual([l["productId"] for l in r.json()["lines"]], [self.product2.pk])
        batch = self.make_batch(self.product2, qty=50, batch_no="T-1", cost=Decimal("80"))
        c.post(f"/api/distribution/orders/{order['id']}/confirm/")
        d = self.client_as("warehouse").post("/api/distribution/dispatches/", self.dispatch_payload(order["id"], [{"productId": self.product2.pk, "batchId": batch.pk, "qty": 4}]), format="json")
        self.assertEqual(d.status_code, 201, d.content)
        self.assertEqual(c.put(f"/api/distribution/orders/{order['id']}/", payload, format="json").status_code, 400)
        self.assertEqual(c.post(f"/api/distribution/orders/{order['id']}/cancel/").status_code, 400)

    def test_listing_is_paginated_filterable_and_permissioned(self):
        self.make_order()
        self.make_order(distributor=self.dist_other)
        body = self.client_as("sales").get("/api/distribution/orders/?page_size=1").json()
        self.assertEqual((body["count"], len(body["results"])), (2, 1))
        only = self.client_as("sales").get(f"/api/distribution/orders/?distributor={self.dist_other.pk}").json()
        self.assertEqual(only["count"], 1)
        self.assertIn(self.client_as(None).get("/api/distribution/orders/").status_code, (401, 403))
        # Accounts may view but not create (distribution is view-only for them).
        self.assertEqual(self.client_as("accounts").get("/api/distribution/orders/").status_code, 200)
        self.assertEqual(self.client_as("accounts").post("/api/distribution/orders/", self.order_payload(), format="json").status_code, 403)


class DispatchTests(DistributionTestMixin, ERPTestCase):
    def test_dispatch_deducts_stock_and_updates_order_status(self):
        batch = self.make_batch(qty=100)
        order = self.make_order()
        r = self.client_as("sales").post(  # the sales role may dispatch (distribution: edit)
            "/api/distribution/dispatches/", self.dispatch_payload(order["id"], [{"productId": self.product.pk, "batchId": batch.pk, "qty": 6}]), format="json"
        )
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        self.assertEqual((body["totalQty"], body["invoiceId"]), (6, None))
        self.assertEqual(bucket_qty(batch.pk, "saleable"), 94)
        mv = StockMovement.objects.filter(type="dispatch").get()
        self.assertEqual((mv.qty, mv.bucket, mv.ref_no), (-6, "saleable", body["dispatchNo"]))
        self.assertEqual(self.client_as("sales").get(f"/api/distribution/orders/{order['id']}/").json()["status"], "partially_dispatched")

        r = self.client_as("warehouse").post(
            "/api/distribution/dispatches/", self.dispatch_payload(order["id"], [{"productId": self.product.pk, "batchId": batch.pk, "qty": 4}]), format="json"
        )
        self.assertEqual(r.status_code, 201)
        final = self.client_as("sales").get(f"/api/distribution/orders/{order['id']}/").json()
        self.assertEqual((final["status"], final["dispatchedPct"], final["hasDispatches"]), ("dispatched", 100, True))
        self.assertEqual(bucket_qty(batch.pk, "saleable"), 90)
        # Fully dispatched: nothing pending, a third dispatch is refused.
        again = self.client_as("warehouse").post("/api/distribution/dispatches/", self.dispatch_payload(order["id"], [{"productId": self.product.pk, "batchId": batch.pk, "qty": 1}]), format="json")
        self.assertEqual(again.status_code, 400)

    def test_insufficient_stock_rejected_and_nothing_persisted(self):
        ok_batch = self.make_batch(self.product, qty=50, batch_no="OK")
        short_batch = self.make_batch(self.product2, qty=3, batch_no="SHORT", cost=Decimal("80"))
        order = self.make_order(lines=[
            {"productId": self.product.pk, "qty": 10, "rate": "15", "discountPct": 0},
            {"productId": self.product2.pk, "qty": 10, "rate": "100", "discountPct": 0},
        ])
        movements = StockMovement.objects.count()
        r = self.client_as("warehouse").post(
            "/api/distribution/dispatches/",
            self.dispatch_payload(order["id"], [
                {"productId": self.product.pk, "batchId": ok_batch.pk, "qty": 10},
                {"productId": self.product2.pk, "batchId": short_batch.pk, "qty": 10},
            ]),
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("only 3 saleable", r.json()["message"])
        # Rolled back as a whole: no dispatch, no movements, balances and order status untouched.
        self.assertEqual(Dispatch.objects.count(), 0)
        self.assertEqual(StockMovement.objects.count(), movements)
        self.assertEqual(bucket_qty(ok_batch.pk, "saleable"), 50)
        self.assertEqual(DistributionOrder.objects.get(pk=order["id"]).status, "confirmed")

    def test_same_batch_used_twice_in_one_request_is_summed(self):
        batch = self.make_batch(qty=8)
        order = self.make_order()
        line = {"productId": self.product.pk, "batchId": batch.pk, "qty": 5}
        r = self.client_as("warehouse").post("/api/distribution/dispatches/", self.dispatch_payload(order["id"], [line, line]), format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(Dispatch.objects.count(), 0)

    def test_expired_batch_rejected(self):
        batch = self.make_batch(qty=100, days_to_expiry=-5, batch_no="OLD")
        order = self.make_order()
        r = self.client_as("warehouse").post("/api/distribution/dispatches/", self.dispatch_payload(order["id"], [{"productId": self.product.pk, "batchId": batch.pk, "qty": 5}]), format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("expired", r.json()["message"])
        self.assertEqual(bucket_qty(batch.pk, "saleable"), 100)

    def test_validation_rules(self):
        batch = self.make_batch(qty=100)
        other = self.make_batch(self.product2, qty=100, batch_no="P2", cost=Decimal("80"))
        order = self.make_order()
        draft = self.make_order(status="draft")
        c = self.client_as("warehouse")
        line = {"productId": self.product.pk, "batchId": batch.pk, "qty": 5}
        # draft orders are not dispatchable
        self.assertEqual(c.post("/api/distribution/dispatches/", self.dispatch_payload(draft["id"], [line]), format="json").status_code, 400)
        # more than pending
        self.assertEqual(c.post("/api/distribution/dispatches/", self.dispatch_payload(order["id"], [{**line, "qty": 11}]), format="json").status_code, 400)
        # batch of another product
        self.assertEqual(c.post("/api/distribution/dispatches/", self.dispatch_payload(order["id"], [{**line, "batchId": other.pk}]), format="json").status_code, 400)
        # product not on the order
        self.assertEqual(c.post("/api/distribution/dispatches/", self.dispatch_payload(order["id"], [{"productId": self.product2.pk, "batchId": other.pk, "qty": 1}]), format="json").status_code, 400)
        # zero quantity / no lines
        self.assertEqual(c.post("/api/distribution/dispatches/", self.dispatch_payload(order["id"], [{**line, "qty": 0}]), format="json").status_code, 400)
        self.assertEqual(c.post("/api/distribution/dispatches/", self.dispatch_payload(order["id"], []), format="json").status_code, 400)
        # dispatch before the order date
        early = self.dispatch_payload(order["id"], [line], date=str(TODAY - timedelta(days=3)))
        self.assertEqual(c.post("/api/distribution/dispatches/", early, format="json").status_code, 400)
        self.assertEqual(Dispatch.objects.count(), 0)

    def test_dispatch_permissions(self):
        batch = self.make_batch(qty=100)
        order = self.make_order()
        body = self.dispatch_payload(order["id"], [{"productId": self.product.pk, "batchId": batch.pk, "qty": 1}])
        self.assertIn(self.client_as(None).post("/api/distribution/dispatches/", body, format="json").status_code, (401, 403))
        self.assertEqual(self.client_as("accounts").post("/api/distribution/dispatches/", body, format="json").status_code, 403)
        self.assertEqual(self.client_as("warehouse").post("/api/distribution/dispatches/", body, format="json").status_code, 201)
        listing = self.client_as("accounts").get("/api/distribution/dispatches/").json()
        self.assertEqual(listing["count"], 1)
        self.assertEqual(listing["results"][0]["orderNo"], order["orderNo"])
