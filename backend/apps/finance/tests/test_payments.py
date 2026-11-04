from datetime import timedelta
from decimal import Decimal
from unittest import mock

from apps.core.testing import TODAY
from apps.finance import services
from apps.finance.models import Payment, PaymentAllocation

from .base import FinanceTestCase

URL = "/api/finance/payments/"


class PaymentAllocationTests(FinanceTestCase):
    def pay(self, role="accounts", **body):
        payload = {"distributorId": str(self.dist_local.pk), "date": str(TODAY), "amount": 500, "mode": "bank_transfer", "reference": "UTR1", "notes": "", "allocations": []}
        payload.update(body)
        return self.client_as(role).post(URL, payload, format="json")

    def invoice_row(self, inv):
        res = self.client_as("accounts").get(f"/api/finance/open-invoices/?distributorId={inv.distributor_id}")
        return next((r for r in self.data(res) if r["id"] == inv.pk), None)

    def test_partial_payment_leaves_outstanding_and_partial_status(self):
        inv = self.make_invoice()  # 1000 + 180 GST = 1180
        self.assertEqual(inv.total, Decimal("1180"))
        res = self.pay(amount=500, allocations=[{"invoiceId": inv.pk, "amount": 500}])
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()
        self.assertEqual(body["allocated"], 500)
        self.assertEqual(body["unallocated"], 0)
        self.assertTrue(body["receiptNo"].startswith("RCT-"))
        row = self.invoice_row(inv)
        self.assertEqual(row["outstanding"], 680)
        self.assertEqual(row["payStatus"], "partial")
        self.assertEqual(row["paid"], 500)

    def test_payment_split_across_invoices_pays_oldest_fully(self):
        a = self.make_invoice(date=TODAY - timedelta(days=40))
        b = self.make_invoice(date=TODAY - timedelta(days=10))
        res = self.pay(amount=2000, allocations=[{"invoiceId": a.pk, "amount": 1180}, {"invoiceId": b.pk, "amount": 820}])
        self.assertEqual(res.status_code, 201, res.content)
        rows = {r["id"]: r for r in self.data(self.client_as("accounts").get(f"/api/finance/open-invoices/?distributorId={self.dist_local.pk}"))}
        self.assertNotIn(a.pk, rows)  # fully paid, no longer open
        self.assertEqual(rows[b.pk]["outstanding"], 360)
        self.assertEqual(PaymentAllocation.objects.count(), 2)

    def test_unallocated_remainder_stays_on_account(self):
        inv = self.make_invoice()
        res = self.pay(amount=2000, allocations=[{"invoiceId": inv.pk, "amount": 1180}])
        self.assertEqual(res.json()["unallocated"], 820)
        bal = next(b for b in self.data(self.client_as("accounts").get("/api/finance/balances/")) if b["distributorId"] == self.dist_local.pk)
        self.assertEqual(bal["unallocated"], 820)
        self.assertEqual(bal["balance"], -820)  # we hold their advance

    def test_total_allocation_cannot_exceed_payment_amount(self):
        a, b = self.make_invoice(), self.make_invoice()
        res = self.pay(amount=1000, allocations=[{"invoiceId": a.pk, "amount": 700}, {"invoiceId": b.pk, "amount": 400}])
        self.assertEqual(res.status_code, 400)
        self.assertIn("exceeds the payment amount", res.json()["message"])
        self.assertEqual(Payment.objects.count(), 0)

    def test_allocation_cannot_exceed_invoice_outstanding(self):
        inv = self.make_invoice()
        res = self.pay(amount=5000, allocations=[{"invoiceId": inv.pk, "amount": 1200}])
        self.assertEqual(res.status_code, 400)
        self.assertIn("exceeds its outstanding", res.json()["message"])
        self.assertEqual(Payment.objects.count(), 0)

    def test_outstanding_accounts_for_earlier_payments(self):
        inv = self.make_invoice()
        self.assertEqual(self.pay(amount=1000, allocations=[{"invoiceId": inv.pk, "amount": 1000}]).status_code, 201)
        res = self.pay(amount=500, allocations=[{"invoiceId": inv.pk, "amount": 500}])  # only 180 left
        self.assertEqual(res.status_code, 400)

    def test_cannot_allocate_to_another_distributors_invoice(self):
        other = self.make_invoice(distributor=self.dist_other)
        res = self.pay(amount=500, allocations=[{"invoiceId": other.pk, "amount": 500}])
        self.assertEqual(res.status_code, 400)
        self.assertIn("does not belong", res.json()["message"])

    def test_duplicate_invoice_in_allocation_rejected(self):
        inv = self.make_invoice()
        res = self.pay(amount=800, allocations=[{"invoiceId": inv.pk, "amount": 400}, {"invoiceId": inv.pk, "amount": 400}])
        self.assertEqual(res.status_code, 400)

    def test_invalid_amounts_rejected(self):
        self.assertEqual(self.pay(amount=0).status_code, 400)
        self.assertEqual(self.pay(amount=-5).status_code, 400)
        self.assertEqual(self.pay(amount="abc").status_code, 400)
        self.assertEqual(self.pay(distributorId="9999").status_code, 400)
        self.assertEqual(self.pay(mode="barter").status_code, 400)

    def test_credit_note_reduces_invoice_outstanding(self):
        inv = self.make_invoice()
        note = self.make_note(inv, "credit", taxable="100", gst="18")  # 118
        self.assertEqual(note.total, Decimal("118"))
        row = self.invoice_row(inv)
        self.assertEqual(row["outstanding"], 1062)
        self.assertEqual(row["payStatus"], "partial")
        res = self.pay(amount=1062, allocations=[{"invoiceId": inv.pk, "amount": 1062}])
        self.assertEqual(res.status_code, 201)
        self.assertIsNone(self.invoice_row(inv))  # fully settled
        full = self.client_as("accounts").get("/api/finance/ledger/?distributorId=%d" % inv.distributor_id)
        self.assertEqual(self.data(full)[-1]["balance"], 0)

    def test_debit_note_increases_outstanding(self):
        inv = self.make_invoice()
        self.make_note(inv, "debit", taxable="100", gst="0")
        self.assertEqual(self.invoice_row(inv)["outstanding"], 1280)

    def test_allocate_existing_payment_up_to_its_unallocated_amount(self):
        a, b = self.make_invoice(), self.make_invoice()
        payment_id = self.pay(amount=1000).json()["id"]  # fully on account
        c = self.client_as("accounts")
        ok = c.post(f"{URL}{payment_id}/allocate/", {"allocations": [{"invoiceId": a.pk, "amount": 600}]}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(ok.json()["unallocated"], 400)
        too_much = c.post(f"{URL}{payment_id}/allocate/", {"allocations": [{"invoiceId": b.pk, "amount": 500}]}, format="json")
        self.assertEqual(too_much.status_code, 400)
        more = c.post(f"{URL}{payment_id}/allocate/", {"allocations": [{"invoiceId": a.pk, "amount": 400}]}, format="json")
        self.assertEqual(more.status_code, 200)
        self.assertEqual(PaymentAllocation.objects.get(payment_id=payment_id, invoice=a).amount, Decimal("1000"))

    def test_failure_midway_rolls_back_the_payment(self):
        inv = self.make_invoice()
        with mock.patch("apps.finance.services.PaymentAllocation.objects.bulk_create", side_effect=RuntimeError("disk full")):
            with self.assertRaises(RuntimeError):
                services.create_payment(
                    self.users["accounts"], distributor=self.dist_local, date=TODAY, amount=Decimal("500"), mode="cash",
                    allocations=[{"invoice_id": inv.pk, "amount": Decimal("500")}],
                )
        self.assertEqual(Payment.objects.count(), 0)
        self.assertEqual(PaymentAllocation.objects.count(), 0)

    def test_list_and_retrieve_payment(self):
        self.pay(amount=300)
        res = self.client_as("accounts").get(URL)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["count"], 1)
        pid = res.json()["results"][0]["id"]
        self.assertEqual(self.client_as("accounts").get(f"{URL}{pid}/").json()["distributorName"], "Local Traders")
        self.assertEqual(self.client_as("accounts").get(f"{URL}9999/").status_code, 404)

    def test_suggested_allocation_is_oldest_due_first(self):
        old = self.make_invoice(date=TODAY - timedelta(days=60))
        new = self.make_invoice(date=TODAY - timedelta(days=5))
        res = self.client_as("accounts").get(f"/api/finance/suggest-allocations/?distributorId={self.dist_local.pk}&amount=1500")
        rows = self.data(res)
        self.assertEqual([r["invoiceId"] for r in rows], [old.pk, new.pk])
        self.assertEqual([r["suggested"] for r in rows], [1180, 320])


class PaymentPermissionTests(FinanceTestCase):
    body = None

    def setUp(self):
        super().setUp()
        self.body = {"distributorId": self.dist_local.pk, "date": str(TODAY), "amount": 100, "mode": "cash", "allocations": []}

    def test_accounts_can_record_payment(self):
        self.assertEqual(self.client_as("accounts").post(URL, self.body, format="json").status_code, 201)

    def test_warehouse_cannot_record_or_view_payments(self):
        self.assertEqual(self.client_as("warehouse").post(URL, self.body, format="json").status_code, 403)
        self.assertEqual(self.client_as("warehouse").get(URL).status_code, 403)
        self.assertEqual(Payment.objects.count(), 0)

    def test_sales_role_can_view_but_not_record(self):
        self.assertEqual(self.client_as("sales").get(URL).status_code, 200)
        self.assertEqual(self.client_as("sales").post(URL, self.body, format="json").status_code, 403)

    def test_anonymous_rejected(self):
        res = self.client_as(None).get(URL)
        self.assertIn(res.status_code, (401, 403))
        self.assertIn(self.client_as(None).post(URL, self.body, format="json").status_code, (401, 403))

    def test_csrf_enforced_for_session_clients(self):
        from rest_framework.test import APIClient

        c = APIClient(enforce_csrf_checks=True)
        c.force_login(self.users["accounts"])
        self.assertEqual(c.post(URL, self.body, format="json").status_code, 403)
