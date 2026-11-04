from datetime import timedelta
from decimal import Decimal

from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.core.testing import TODAY, ERPTestCase
from apps.finance.models import Payment, PaymentAllocation
from apps.sales.models import Invoice

from .helpers import SalesFlowMixin


class InvoiceTests(SalesFlowMixin, ERPTestCase):
    def test_intra_state_invoice_splits_gst_into_cgst_and_sgst(self):
        inv = self.make_invoice(self.dist_local)  # 7 x 15.00, 10% discount, 18% GST, Karnataka -> Karnataka
        d = self.dec
        self.assertFalse(inv["interState"])
        self.assertEqual(d(inv["taxable"]), Decimal("94.50"))  # 105.00 - 10.50
        self.assertEqual((d(inv["cgst"]), d(inv["sgst"]), d(inv["igst"])), (Decimal("8.51"), Decimal("8.50"), Decimal("0")))
        self.assertEqual(d(inv["roundOff"]), Decimal("0.49"))  # 111.51 rounded up to 112
        self.assertEqual(d(inv["total"]), Decimal("112"))
        line = inv["lines"][0]
        self.assertEqual((d(line["taxable"]), d(line["cgst"]), d(line["sgst"]), d(line["igst"])), (Decimal("94.50"), Decimal("8.51"), Decimal("8.50"), Decimal("0")))
        self.assertEqual(d(line["unitCost"]), Decimal("10.00"))  # batch cost snapshot
        self.assertEqual(inv["dueDate"], str(TODAY + timedelta(days=30)))
        self.assertEqual((inv["paid"], inv["credited"], inv["payStatus"], inv["overdue"]), (0, 0, "unpaid", False))
        self.assertEqual(d(inv["outstanding"]), Decimal("112"))

    def test_inter_state_invoice_uses_igst_only(self):
        inv = self.make_invoice(self.dist_other)  # Tamil Nadu
        d = self.dec
        self.assertTrue(inv["interState"])
        self.assertEqual((d(inv["cgst"]), d(inv["sgst"]), d(inv["igst"])), (Decimal("0"), Decimal("0"), Decimal("17.01")))
        self.assertEqual(d(inv["total"]), Decimal("112"))
        self.assertEqual(d(inv["lines"][0]["igst"]), Decimal("17.01"))
        row = Invoice.objects.get(pk=inv["id"])
        self.assertTrue(row.inter_state and row.cgst == 0 and row.sgst == 0)

    def test_totals_equal_the_sum_of_lines_for_multi_line_invoices(self):
        b1 = self.make_batch(self.product, qty=500, batch_no="M1")
        b2 = self.make_batch(self.product2, qty=500, batch_no="M2", cost=Decimal("80"))
        order = self.client_as("sales").post(
            "/api/distribution/orders/",
            {"distributorId": self.dist_local.pk, "date": str(TODAY), "status": "confirmed", "lines": [
                {"productId": self.product.pk, "qty": 13, "rate": "14.35", "discountPct": 3},
                {"productId": self.product2.pk, "qty": 9, "rate": "99.99", "discountPct": 0},
            ]}, format="json").json()
        dsp = self.client_as("warehouse").post("/api/distribution/dispatches/", {"orderId": order["id"], "date": str(TODAY), "lines": [
            {"productId": self.product.pk, "batchId": b1.pk, "qty": 13}, {"productId": self.product2.pk, "batchId": b2.pk, "qty": 9}]}, format="json").json()
        inv = self.client_as("accounts").post("/api/sales/invoices/", {"dispatchId": dsp["id"], "date": str(TODAY)}, format="json").json()
        d = self.dec
        self.assertEqual(sum(d(l["taxable"]) for l in inv["lines"]), d(inv["taxable"]))
        self.assertEqual(sum(d(l["cgst"]) for l in inv["lines"]), d(inv["cgst"]))
        self.assertEqual(sum(d(l["sgst"]) for l in inv["lines"]), d(inv["sgst"]))
        self.assertEqual(d(inv["taxable"]) + d(inv["cgst"]) + d(inv["sgst"]) + d(inv["igst"]) + d(inv["roundOff"]), d(inv["total"]))
        self.assertEqual(d(inv["total"]), d(inv["total"]).to_integral_value())

    def test_client_supplied_totals_are_ignored(self):
        batch = self.make_batch(qty=100)
        order = self.client_as("sales").post("/api/distribution/orders/", {"distributorId": self.dist_local.pk, "date": str(TODAY), "status": "confirmed",
            "lines": [{"productId": self.product.pk, "qty": 10, "rate": "15", "discountPct": 0}]}, format="json").json()
        dsp = self.client_as("warehouse").post("/api/distribution/dispatches/", {"orderId": order["id"], "date": str(TODAY), "lines": [
            {"productId": self.product.pk, "batchId": batch.pk, "qty": 10}]}, format="json").json()
        r = self.client_as("accounts").post("/api/sales/invoices/", {"dispatchId": dsp["id"], "date": str(TODAY), "total": 1, "taxable": 1, "cgst": 0, "lines": []}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.dec(r.json()["total"]), Decimal("177"))  # 150 + 27 GST

    def test_one_invoice_per_dispatch(self):
        inv = self.make_invoice()
        r = self.client_as("accounts").post("/api/sales/invoices/", {"dispatchId": inv["dispatchId"], "date": str(TODAY)}, format="json")
        self.assertEqual(r.status_code, 409)
        self.assertIn("already been invoiced", r.json()["message"])
        self.assertEqual(Invoice.objects.count(), 1)

    def test_invoice_numbers_are_unique_and_sequential(self):
        a = self.make_invoice(qty=3)
        b = self.make_invoice(qty=4)
        c = self.make_invoice(self.dist_other, qty=5)
        nos = [a["invoiceNo"], b["invoiceNo"], c["invoiceNo"]]
        self.assertEqual(nos, [f"INV-{TODAY.year}-000{i}" for i in (1, 2, 3)])
        self.assertEqual(len(set(Invoice.objects.values_list("invoice_no", flat=True))), 3)

    def test_invoice_date_cannot_precede_dispatch(self):
        batch = self.make_batch(qty=100)
        order = self.client_as("sales").post("/api/distribution/orders/", {"distributorId": self.dist_local.pk, "date": str(TODAY), "status": "confirmed",
            "lines": [{"productId": self.product.pk, "qty": 2, "rate": "15", "discountPct": 0}]}, format="json").json()
        dsp = self.client_as("warehouse").post("/api/distribution/dispatches/", {"orderId": order["id"], "date": str(TODAY), "lines": [
            {"productId": self.product.pk, "batchId": batch.pk, "qty": 2}]}, format="json").json()
        r = self.client_as("accounts").post("/api/sales/invoices/", {"dispatchId": dsp["id"], "date": str(TODAY - timedelta(days=1))}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.client_as("accounts").post("/api/sales/invoices/", {"dispatchId": 99999, "date": str(TODAY)}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_uninvoiced_dispatches_listing(self):
        batch = self.make_batch(qty=100)
        order = self.client_as("sales").post("/api/distribution/orders/", {"distributorId": self.dist_local.pk, "date": str(TODAY), "status": "confirmed",
            "lines": [{"productId": self.product.pk, "qty": 2, "rate": "15", "discountPct": 0}]}, format="json").json()
        dsp = self.client_as("warehouse").post("/api/distribution/dispatches/", {"orderId": order["id"], "date": str(TODAY), "lines": [
            {"productId": self.product.pk, "batchId": batch.pk, "qty": 2}]}, format="json").json()
        before = self.client_as("accounts").get("/api/sales/invoices/uninvoiced-dispatches/").json()
        self.assertEqual([r["id"] for r in before["results"]], [dsp["id"]])
        self.client_as("accounts").post("/api/sales/invoices/", {"dispatchId": dsp["id"], "date": str(TODAY)}, format="json")
        self.assertEqual(self.client_as("accounts").get("/api/sales/invoices/uninvoiced-dispatches/").json()["count"], 0)

    def test_outstanding_reflects_partial_payments_and_status(self):
        inv = self.make_invoice()  # total 112
        pay = Payment.objects.create(receipt_no="R-1", distributor=self.dist_local, date=TODAY, amount=Decimal("40"), mode="cash")
        PaymentAllocation.objects.create(payment=pay, invoice_id=inv["id"], amount=Decimal("40"))
        row = self.client_as("accounts").get(f"/api/sales/invoices/{inv['id']}/").json()
        self.assertEqual((self.dec(row["paid"]), self.dec(row["outstanding"]), row["payStatus"]), (Decimal("40"), Decimal("72"), "partial"))
        pay2 = Payment.objects.create(receipt_no="R-2", distributor=self.dist_local, date=TODAY, amount=Decimal("72"), mode="upi")
        PaymentAllocation.objects.create(payment=pay2, invoice_id=inv["id"], amount=Decimal("72"))
        row = self.client_as("accounts").get(f"/api/sales/invoices/{inv['id']}/").json()
        self.assertEqual((self.dec(row["outstanding"]), row["payStatus"]), (Decimal("0"), "paid"))

    def test_overdue_flag(self):
        inv = self.make_invoice()
        Invoice.objects.filter(pk=inv["id"]).update(date=TODAY - timedelta(days=60), due_date=TODAY - timedelta(days=30))
        row = self.client_as("accounts").get(f"/api/sales/invoices/{inv['id']}/").json()
        self.assertEqual((row["overdue"], row["daysOverdue"]), (True, 30))

    def test_listing_uses_a_constant_number_of_queries(self):
        self.make_invoice(qty=2)
        c = self.client_as("accounts")
        with CaptureQueriesContext(connection) as one:
            c.get("/api/sales/invoices/")
        for q in (3, 4, 5):
            self.make_invoice(qty=q)
        with CaptureQueriesContext(connection) as many:
            body = c.get("/api/sales/invoices/").json()
        self.assertEqual(body["count"], 4)
        self.assertEqual(len(many), len(one))

    def test_filters_search_and_ordering(self):
        self.make_invoice(self.dist_local, qty=2)
        self.make_invoice(self.dist_other, qty=3)
        c = self.client_as("accounts")
        self.assertEqual(c.get(f"/api/sales/invoices/?distributor={self.dist_other.pk}").json()["count"], 1)
        self.assertEqual(c.get("/api/sales/invoices/?search=Chennai").json()["count"], 1)
        asc = [r["invoiceNo"] for r in c.get("/api/sales/invoices/?ordering=invoice_no").json()["results"]]
        self.assertEqual(asc, sorted(asc))

    def test_permissions(self):
        inv = self.make_invoice()
        body = {"dispatchId": inv["dispatchId"], "date": str(TODAY)}
        self.assertIn(self.client_as(None).get("/api/sales/invoices/").status_code, (401, 403))
        self.assertEqual(self.client_as("warehouse").post("/api/sales/invoices/", body, format="json").status_code, 403)  # sales: view only
        self.assertEqual(self.client_as("warehouse").get("/api/sales/invoices/").status_code, 200)
        self.assertEqual(self.client_as("sales").post("/api/sales/invoices/", body, format="json").status_code, 409)  # allowed, but already invoiced
        self.assertEqual(self.client_as("accounts").put(f"/api/sales/invoices/{inv['id']}/", {}, format="json").status_code, 405)
        self.assertEqual(self.client_as("admin").delete(f"/api/sales/invoices/{inv['id']}/").status_code, 405)  # invoices are never deleted
