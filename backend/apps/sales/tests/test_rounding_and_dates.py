from datetime import timedelta
from decimal import Decimal

from apps.core.testing import TODAY, ERPTestCase
from apps.sales.models import NoteDocument

from .helpers import SalesFlowMixin

TOMORROW = TODAY + timedelta(days=1)


class ReturnRoundingTests(SalesFlowMixin, ERPTestCase):
    """The invoice total is rounded to the rupee; credits for returned goods must still add up to exactly that total."""

    def setUp(self):
        super().setUp()
        self.batch = self.make_batch(qty=500, batch_no="RO-1", cost=Decimal("10.00"))
        # 12 x 80 less 2% = 940.80 taxable + 169.34 IGST = 1110.14, rounded to 1110.00 (round-off -0.14)
        self.inv = self.make_invoice(self.dist_other, qty=12, rate="80.00", discount=2, batch=self.batch)

    def do_return(self, qty):
        r = self.client_as("sales").post(
            "/api/sales/returns/",
            {"invoiceId": self.inv["id"], "date": str(TODAY), "reason": "damaged", "notes": "", "issueCreditNote": True,
             "lines": [{"productId": self.product.pk, "batchId": self.batch.pk, "qty": qty, "classification": "saleable"}]},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)

    def balance(self):
        rows = self.client_as("accounts").get("/api/finance/balances/").json()["results"]
        return self.dec(next(r for r in rows if r["distributorId"] == self.dist_other.pk)["balance"])

    def test_invoice_is_rounded_as_expected(self):
        self.assertEqual((self.dec(self.inv["roundOff"]), self.dec(self.inv["total"])), (Decimal("-0.14"), Decimal("1110.00")))

    def test_full_return_in_two_steps_credits_exactly_the_invoice_total(self):
        self.do_return(5)
        first = NoteDocument.objects.get()
        self.assertEqual(first.round_off, 0)  # a partial return is credited at the exact value of the goods
        self.do_return(7)
        notes = NoteDocument.objects.order_by("pk")
        self.assertEqual(sum(n.total for n in notes), Decimal("1110.00"))
        self.assertEqual(notes[1].round_off, Decimal("-0.14"))
        self.assertEqual(notes[1].total, notes[1].taxable + notes[1].igst + notes[1].round_off)
        inv = self.client_as("accounts").get(f"/api/sales/invoices/{self.inv['id']}/").json()
        self.assertEqual((inv["outstanding"], inv["payStatus"]), (0, "paid"))
        self.assertEqual(self.balance(), Decimal("0.00"))  # distributor balance must not drift by the round-off

    def test_full_return_in_one_step(self):
        self.do_return(12)
        self.assertEqual(NoteDocument.objects.get().total, Decimal("1110.00"))
        self.assertEqual(self.balance(), Decimal("0.00"))

    def test_other_invoices_are_not_affected_by_the_credit(self):
        other = self.make_invoice(self.dist_other, qty=10, rate="100.00", discount=0, product=self.product2)  # 1000 + 5% = 1050
        self.do_return(12)
        self.assertEqual(self.balance(), self.dec(other["total"]))


class FutureDateTests(SalesFlowMixin, ERPTestCase):
    """Documents record events that already happened; a future date would hide them behind "up to today" filters."""

    def order_payload(self, date):
        return {"distributorId": self.dist_local.pk, "date": str(date), "status": "confirmed", "lines": [{"productId": self.product.pk, "qty": 2, "rate": "15.00", "discountPct": 0}]}

    def test_future_order_rejected_on_create_and_update(self):
        c = self.client_as("sales")
        r = c.post("/api/distribution/orders/", self.order_payload(TOMORROW), format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("Order date cannot be in the future", r.json()["message"])
        ok = c.post("/api/distribution/orders/", {**self.order_payload(TODAY), "status": "draft"}, format="json")
        self.assertEqual(ok.status_code, 201)
        self.assertEqual(c.put(f"/api/distribution/orders/{ok.json()['id']}/", {**self.order_payload(TOMORROW), "status": "draft"}, format="json").status_code, 400)

    def test_future_dispatch_invoice_return_and_note_rejected(self):
        batch = self.make_batch(qty=100, batch_no="FD-1")
        order = self.client_as("sales").post("/api/distribution/orders/", self.order_payload(TODAY), format="json").json()
        line = {"productId": self.product.pk, "batchId": batch.pk, "qty": 2}
        r = self.client_as("warehouse").post("/api/distribution/dispatches/", {"orderId": order["id"], "date": str(TOMORROW), "lines": [line]}, format="json")
        self.assertEqual((r.status_code, "Dispatch date cannot be in the future" in r.json()["message"]), (400, True))
        disp = self.client_as("warehouse").post("/api/distribution/dispatches/", {"orderId": order["id"], "date": str(TODAY), "lines": [line]}, format="json").json()
        accounts = self.client_as("accounts")
        r = accounts.post("/api/sales/invoices/", {"dispatchId": disp["id"], "date": str(TOMORROW)}, format="json")
        self.assertEqual((r.status_code, "Invoice date cannot be in the future" in r.json()["message"]), (400, True))
        inv = accounts.post("/api/sales/invoices/", {"dispatchId": disp["id"], "date": str(TODAY)}, format="json").json()
        r = self.client_as("sales").post(
            "/api/sales/returns/",
            {"invoiceId": inv["id"], "date": str(TOMORROW), "reason": "damaged", "notes": "", "issueCreditNote": False,
             "lines": [{"productId": self.product.pk, "batchId": batch.pk, "qty": 1, "classification": "saleable"}]},
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        r = accounts.post("/api/sales/notes/", {"type": "credit", "distributorId": self.dist_local.pk, "invoiceId": None, "date": str(TOMORROW), "reason": "x", "taxable": "10.00", "gstRate": 18}, format="json")
        self.assertEqual(r.status_code, 400)
