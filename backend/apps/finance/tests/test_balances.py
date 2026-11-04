from datetime import timedelta
from decimal import Decimal

from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.core.testing import TODAY
from apps.finance.models import Payment, PaymentAllocation

from .base import FinanceTestCase


class BalanceAndLedgerTests(FinanceTestCase):
    def balance(self, distributor):
        rows = self.data(self.client_as("accounts").get("/api/finance/balances/"))
        return next(r for r in rows if r["distributorId"] == distributor.pk)

    def test_balance_combines_invoices_notes_and_receipts(self):
        inv = self.make_invoice()  # 1180
        self.make_note(inv, "debit", taxable="100", gst="18")  # +118
        self.make_note(inv, "credit", taxable="50", gst="18")  # -59
        pay = Payment.objects.create(receipt_no="RCT-T-1", distributor=self.dist_local, date=TODAY, amount=Decimal("500"), mode="cash")
        PaymentAllocation.objects.create(payment=pay, invoice=inv, amount=Decimal("500"))
        b = self.balance(self.dist_local)
        self.assertEqual(Decimal(str(b["balance"])), Decimal("739"))  # 1180 + 118 - 59 - 500
        self.assertEqual((b["invoiced"], b["debitNotes"], b["creditNotes"], b["received"]), (1180, 118, 59, 500))
        self.assertEqual(b["unallocated"], 0)

    def test_ledger_running_balance_ends_at_the_balance(self):
        inv = self.make_invoice(date=TODAY - timedelta(days=20))
        self.make_note(inv, "credit", taxable="100", date=TODAY - timedelta(days=10))
        Payment.objects.create(receipt_no="RCT-T-2", distributor=self.dist_local, date=TODAY - timedelta(days=5), amount=Decimal("300"), mode="upi", reference="X1")
        entries = self.data(self.client_as("accounts").get(f"/api/finance/ledger/?distributorId={self.dist_local.pk}"))
        self.assertEqual([e["type"] for e in entries], ["invoice", "credit_note", "payment"])
        self.assertEqual([e["balance"] for e in entries], [1180, 1062, 762])
        self.assertEqual(entries[-1]["balance"], self.balance(self.dist_local)["balance"])
        self.assertIn("UPI".lower(), entries[2]["description"].lower())

    def test_same_day_entries_order_invoice_note_payment(self):
        inv = self.make_invoice()
        Payment.objects.create(receipt_no="RCT-T-3", distributor=self.dist_local, date=TODAY, amount=Decimal("100"), mode="cash")
        self.make_note(inv, "credit", taxable="10", gst="0")
        types = [e["type"] for e in self.data(self.client_as("accounts").get(f"/api/finance/ledger/?distributorId={self.dist_local.pk}"))]
        self.assertEqual(types, ["invoice", "credit_note", "payment"])

    def test_overdue_and_credit_limit(self):
        self.dist_local.credit_limit = Decimal("1000")
        self.dist_local.save()
        self.make_invoice(date=TODAY - timedelta(days=45))  # due 15 days ago
        self.make_invoice(date=TODAY - timedelta(days=2))  # not yet due
        b = self.balance(self.dist_local)
        self.assertEqual(b["overdueInvoices"], 1)
        self.assertEqual(b["overdueAmount"], 1180)
        self.assertTrue(b["overLimit"])
        self.assertEqual(b["creditUsedPct"], 236)

    def test_overdue_flag_and_days_on_invoice_rows(self):
        inv = self.make_invoice(date=TODAY - timedelta(days=45))
        rows = self.data(self.client_as("accounts").get(f"/api/finance/open-invoices/?distributorId={inv.distributor_id}"))
        self.assertTrue(rows[0]["overdue"])
        self.assertEqual(rows[0]["daysOverdue"], 15)
        self.assertEqual(rows[0]["payStatus"], "unpaid")

    def test_missing_distributor_parameter_is_a_clean_400(self):
        res = self.client_as("accounts").get("/api/finance/ledger/")
        self.assertEqual(res.status_code, 400)
        self.assertIn("distributorId", res.json()["message"])

    def test_balances_use_a_constant_number_of_queries(self):
        c = self.client_as("accounts")
        self.make_invoice()
        with CaptureQueriesContext(connection) as few:
            self.assertEqual(c.get("/api/finance/balances/").status_code, 200)
        for _ in range(8):
            self.make_invoice(distributor=self.dist_other)
        with CaptureQueriesContext(connection) as many:
            self.assertEqual(c.get("/api/finance/balances/").status_code, 200)
        self.assertEqual(len(few), len(many))
        self.assertLess(len(many), 20)

    def test_open_invoices_use_a_constant_number_of_queries(self):
        c = self.client_as("accounts")
        self.make_invoice()
        with CaptureQueriesContext(connection) as few:
            c.get(f"/api/finance/open-invoices/?distributorId={self.dist_local.pk}")
        for _ in range(6):
            self.make_invoice()
        with CaptureQueriesContext(connection) as many:
            c.get(f"/api/finance/open-invoices/?distributorId={self.dist_local.pk}")
        self.assertEqual(len(few), len(many))
