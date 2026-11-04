from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from apps.distribution.models import Dispatch
from apps.finance.models import Payment
from apps.finance.selectors import distributor_balances, invoice_rows, ledger_for
from apps.inventory.selectors import batch_stock_rows
from apps.sales.models import Invoice, SalesReturnLine


class SeedDemoTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.out = StringIO()
        call_command("seed_demo", password="Test-Seed-Pass-1", stdout=cls.out)

    def test_runs_and_refuses_to_run_twice_without_flush(self):
        from django.core.management.base import CommandError

        assert "Demo data created" in self.out.getvalue()
        assert Invoice.objects.count() > 60
        with self.assertRaises(CommandError):
            call_command("seed_demo", password="x", stdout=StringIO())

    def test_no_negative_stock_in_any_bucket(self):
        for b in batch_stock_rows():
            assert min(b["saleable"], b["damaged"], b["expired"], b["inspection"]) >= 0, b["batch_no"]

    def test_invoice_totals_equal_lines_plus_round_off(self):
        for inv in Invoice.objects.prefetch_related("lines"):
            lines = list(inv.lines.all())
            assert inv.taxable == sum(l.taxable for l in lines)
            assert inv.total == inv.taxable + inv.cgst + inv.sgst + inv.igst + inv.round_off
            assert inv.round_off == inv.total - (inv.taxable + inv.cgst + inv.sgst + inv.igst)
            assert (inv.igst == 0) if not inv.inter_state else (inv.cgst == 0 and inv.sgst == 0)

    def test_ledger_closing_balance_matches_balance(self):
        for b in distributor_balances():
            ledger = ledger_for(b["distributor_id"])
            closing = ledger[-1]["balance"] if ledger else Decimal("0")
            assert closing == b["balance"], b["distributor_name"]

    def test_allocations_never_exceed_payments_or_invoices(self):
        for p in Payment.objects.prefetch_related("allocations"):
            assert sum((a.amount for a in p.allocations.all()), Decimal("0")) <= p.amount
        for row in invoice_rows():
            assert row["outstanding"] >= 0
            assert row["paid"] <= row["total"]

    def test_scenarios_the_ui_needs_exist(self):
        rows = batch_stock_rows()
        assert any(b["expiry_status"] in ("critical", "warning") and b["saleable"] > 0 for b in rows), "no expiring batch"
        assert any(b["expiry_status"] == "expired" and b["saleable"] > 0 for b in rows), "no expired batch with stock"
        assert any(r["overdue"] for r in invoice_rows()), "no overdue invoice"
        assert any(b["over_limit"] for b in distributor_balances()), "no over-limit distributor"
        assert SalesReturnLine.objects.filter(classification="inspection").exists(), "no pending inspection"
        assert Dispatch.objects.filter(invoice__isnull=True).exists(), "no uninvoiced dispatch"
        assert Payment.objects.filter(allocations__isnull=True).exists(), "no on-account payment"
