from decimal import Decimal

from apps.core.testing import TODAY


class SalesFlowMixin:
    """Builds order -> dispatch -> invoice through the public API."""

    def make_invoice(self, distributor=None, qty=7, rate="15.00", discount=10, product=None, batch=None, invoice_date=None):
        distributor = distributor or self.dist_local
        product = product or self.product
        batch = batch or self.make_batch(product, qty=1000, batch_no=f"B-{distributor.pk}-{product.pk}-{qty}", cost=Decimal("10.00"))
        order = self.client_as("sales").post(
            "/api/distribution/orders/",
            {"distributorId": distributor.pk, "date": str(TODAY), "status": "confirmed",
             "lines": [{"productId": product.pk, "qty": qty, "rate": rate, "discountPct": discount}]},
            format="json",
        )
        self.assertEqual(order.status_code, 201, order.content)
        dispatch = self.client_as("warehouse").post(
            "/api/distribution/dispatches/",
            {"orderId": order.json()["id"], "date": str(TODAY), "lines": [{"productId": product.pk, "batchId": batch.pk, "qty": qty}]},
            format="json",
        )
        self.assertEqual(dispatch.status_code, 201, dispatch.content)
        resp = self.client_as("accounts").post("/api/sales/invoices/", {"dispatchId": dispatch.json()["id"], "date": str(invoice_date or TODAY)}, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        return resp.json()

    @staticmethod
    def dec(value):
        return Decimal(str(value))
