import csv
import io
from datetime import timedelta
from decimal import Decimal

from apps.core.testing import TODAY
from apps.finance.tests.base import FinanceTestCase

R = "/api/reports/"


class ReportTestBase(FinanceTestCase):
    def setUp(self):
        super().setUp()
        # Two intra-state invoices at different GST rates and one inter-state invoice.
        self.inv_a = self.make_invoice(qty=10, rate="100", gst="18", unit_cost="60")  # taxable 1000, cgst/sgst 90 each
        self.inv_b = self.make_invoice(qty=5, rate="200", gst="5", product=self.product2, unit_cost="80")  # taxable 1000, 25 + 25
        self.inv_c = self.make_invoice(distributor=self.dist_other, qty=3, rate="33.33", gst="5", unit_cost="20")  # IGST
        self.ret = self.make_return(self.inv_a, qty=2, classification="saleable")  # -200 revenue, -120 cost

    def get(self, path, role="accounts", **params):
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        return self.client_as(role).get(f"{R}{path}/" + (f"?{qs}" if qs else ""))

    @staticmethod
    def csv_rows(res):
        text = res.content.decode("utf-8-sig")
        return list(csv.reader(io.StringIO(text)))


class SalesProfitabilityTests(ReportTestBase):
    def test_revenue_cost_and_margin_are_net_of_saleable_returns(self):
        body = self.get("sales-profitability").json()
        by_no = {r["invoiceNo"]: r for r in body["rows"]}
        a = by_no[self.inv_a.invoice_no]
        self.assertEqual((a["revenue"], a["cost"], a["margin"], a["marginPct"]), (800, 480, 320, 40))
        b = by_no[self.inv_b.invoice_no]
        self.assertEqual((b["revenue"], b["cost"], b["margin"]), (1000, 400, 600))
        self.assertEqual(len(body["trend"]), 1)
        self.assertEqual(self.dec(body["trend"][0]["revenue"]), self.dec(sum(r["revenue"] for r in body["rows"])))

    def test_damaged_returns_reduce_revenue_but_keep_cost(self):
        ret = self.make_return(self.inv_b, qty=1, classification="damaged")
        self.assertTrue(ret.pk)
        row = {r["invoiceNo"]: r for r in self.get("sales-profitability").json()["rows"]}[self.inv_b.invoice_no]
        self.assertEqual((row["revenue"], row["cost"]), (800, 400))  # revenue -200; damaged goods keep their cost

    def test_csv_matches_json(self):
        body = self.get("sales-profitability").json()
        rows = self.csv_rows(self.get("sales-profitability", export="csv"))
        self.assertEqual(rows[0][:4], ["Invoice no", "Date", "Distributor", "Revenue"])
        self.assertEqual(len(rows) - 1, len(body["rows"]))
        self.assertEqual(sum(Decimal(r[3]) for r in rows[1:]), sum(self.dec(r["revenue"]) for r in body["rows"]))

    def test_date_range_excludes_other_periods(self):
        old = self.make_invoice(date=TODAY - timedelta(days=400))
        rng = {"from": TODAY - timedelta(days=30), "to": TODAY}
        nos = [r["invoiceNo"] for r in self.get("sales-profitability", **rng).json()["rows"]]
        self.assertNotIn(old.invoice_no, nos)
        self.assertIn(self.inv_a.invoice_no, nos)


class BrandProductDistributorTests(ReportTestBase):
    def test_brand_report_totals_match_facts(self):
        rows = self.get("brands").json()
        brand = rows[0]
        self.assertEqual(brand["qtySold"], 10 + 5 + 3 - 2)
        self.assertEqual(self.dec(brand["revenue"]), self.dec(800 + 1000 + Decimal("99.99")))
        self.assertEqual(self.dec(brand["margin"]), self.dec(brand["revenue"]) - self.dec(brand["cost"]))
        self.assertEqual(self.get("brands", export="csv").status_code, 200)

    def test_product_classification(self):
        rows = {r["sku"]: r for r in self.get("products").json()}
        self.assertEqual(rows["SKU-2"]["classification"], "high_selling")  # biggest revenue of two sellers
        self.assertEqual(rows["SKU-1"]["classification"], "slow_moving")
        self.assertEqual(rows["SKU-1"]["qtySold"], 11)  # 10 + 3 - 2 returned
        self.assertEqual(rows["SKU-2"]["lastSaleDate"], str(TODAY))

    def test_unsold_active_product_is_low_performing(self):
        from apps.catalog.models import Product

        p = Product.objects.create(
            sku="SKU-3", name="Unsold", brand=self.product.brand, category=self.product.category, unit=self.product.unit,
            pack_unit=self.product.pack_unit, pack_size=1, purchase_price=Decimal("1"), selling_price=Decimal("2"),
        )
        rows = {r["sku"]: r for r in self.get("products").json()}
        self.assertEqual(rows[p.sku]["classification"], "low_performing")

    def test_distributor_performance(self):
        from apps.finance.models import Payment

        Payment.objects.create(receipt_no="RCT-T-50", distributor=self.dist_local, date=TODAY, amount=Decimal("500"), mode="cash")
        rows = {r["distributorName"]: r for r in self.get("distributors").json()}
        local = rows["Local Traders"]
        self.assertEqual((local["invoices"], local["taxable"], local["collected"], local["returnsValue"]), (2, 2000, 500, 200))
        self.assertEqual(local["returnPct"], 10)
        self.assertIsNone(local["reportedSales"])
        self.assertEqual(local["outstanding"], 1180 + 1050 - 500)

    def test_distributor_reported_sales_only_from_reports(self):
        from apps.distribution.models import DistributorStockReport

        DistributorStockReport.objects.create(
            distributor=self.dist_local, product=self.product, period=TODAY.strftime("%Y-%m"), reported_sales=7, remaining_stock=3, reported_on=TODAY
        )
        rows = {r["distributorName"]: r for r in self.get("distributors").json()}
        self.assertEqual(rows["Local Traders"]["reportedSales"], 7)
        self.assertIsNone(rows["Chennai Traders"]["reportedSales"])


class RegisterTests(ReportTestBase):
    def test_sales_register_and_csv_agree(self):
        rows = self.get("sales-register").json()
        self.assertEqual(len(rows), 3)
        csv_rows = self.csv_rows(self.get("sales-register", export="csv"))
        self.assertEqual(csv_rows[0][-1], "Total")
        self.assertEqual(sum(Decimal(r[-1]) for r in csv_rows[1:]), sum(self.dec(r["total"]) for r in rows))
        self.assertEqual(sum(Decimal(r[4]) for r in csv_rows[1:]), sum(self.dec(r["taxable"]) for r in rows))

    def test_purchase_register_splits_tax_by_state(self):
        from apps.parties.models import Supplier

        self.make_grn(taxable="500", tax="90")  # supplier in Karnataka -> CGST+SGST
        far = Supplier.objects.create(name="Far Supplier", state="Maharashtra")
        self.make_grn(taxable="200", tax="36", supplier=far)  # inter-state -> IGST
        rows = {r["supplierName"]: r for r in self.get("purchase-register").json()}
        self.assertEqual((rows["Supplier One"]["cgst"], rows["Supplier One"]["sgst"], rows["Supplier One"]["igst"]), (45, 45, 0))
        self.assertEqual((rows["Far Supplier"]["cgst"], rows["Far Supplier"]["igst"]), (0, 36))
        csv_rows = self.csv_rows(self.get("purchase-register", export="csv"))
        self.assertEqual(len(csv_rows) - 1, 2)


class GstSummaryTests(ReportTestBase):
    def test_by_rate_exact_decimals(self):
        s = self.get("gst-summary").json()
        by_rate = {r["rate"]: r for r in s["byRate"]}
        self.assertEqual(set(by_rate), {5, 18})
        self.assertEqual((by_rate[18]["taxable"], by_rate[18]["cgst"], by_rate[18]["sgst"], by_rate[18]["igst"]), (1000, 90, 90, 0))
        # 5%: local invoice 1000 -> 25 + 25, inter-state invoice 99.99 -> IGST 5.00 (4.9995 rounds half up)
        self.assertEqual(self.dec(by_rate[5]["taxable"]), Decimal("1099.99"))
        self.assertEqual((by_rate[5]["cgst"], by_rate[5]["sgst"]), (25, 25))
        self.assertEqual(self.dec(by_rate[5]["igst"]), Decimal("5.00"))
        self.assertEqual(self.dec(s["output"]["tax"]), Decimal("180") + Decimal("50") + Decimal("5.00"))

    def test_credit_note_reduces_net_tax_and_input_tax_nets_supplier_returns(self):
        self.make_note(self.inv_a, "credit", taxable="100", gst="18")  # tax 18
        self.make_note(self.inv_a, "debit", taxable="50", gst="18")  # tax 9
        self.make_grn(taxable="500", tax="90")
        self.make_supplier_return(taxable="50", tax="9")
        s = self.get("gst-summary").json()
        o = s["output"]
        self.assertEqual((o["creditNoteTax"], o["debitNoteTax"]), (18, 9))
        self.assertEqual(self.dec(o["netTax"]), self.dec(o["tax"]) - 18 + 9)
        self.assertEqual((s["input"]["taxable"], s["input"]["tax"]), (450, 81))

    def test_csv_totals_match_json(self):
        s = self.get("gst-summary").json()
        rows = self.csv_rows(self.get("gst-summary", export="csv"))
        rate_rows = [r for r in rows if r[0] == "By GST rate"]
        self.assertEqual(sum(Decimal(r[2]) for r in rate_rows), sum(self.dec(r["taxable"]) for r in s["byRate"]))
        total = next(r for r in rows if r[0] == "Output total")
        self.assertEqual(Decimal(total[6]), self.dec(s["output"]["tax"]))
        self.assertEqual(Decimal(total[2]), self.dec(s["output"]["taxable"]))


class ReportAccessTests(ReportTestBase):
    def test_accounts_and_admin_may_view_but_nobody_unauthenticated(self):
        for path in ("sales-profitability", "brands", "products", "distributors", "purchase-register", "sales-register", "gst-summary"):
            self.assertEqual(self.get(path).status_code, 200, path)
            self.assertIn(self.client_as(None).get(f"{R}{path}/").status_code, (401, 403), path)

    def test_role_without_reports_permission_is_blocked(self):
        from apps.users.models import RolePermission

        RolePermission.objects.filter(role="sales", module="reports").update(level="none")
        self.assertEqual(self.get("brands", role="sales").status_code, 403)
        self.assertEqual(self.get("brands", role="warehouse").status_code, 200)

    def test_reports_are_read_only(self):
        self.assertEqual(self.client_as("admin").post(f"{R}brands/", {}, format="json").status_code, 405)

    def test_bad_dates_are_rejected(self):
        self.assertEqual(self.get("brands", **{"from": "2026-13-45"}).status_code, 400)
        self.assertEqual(self.get("brands", **{"from": "2026-05-01", "to": "2026-04-01"}).status_code, 400)

    def test_csv_text_cells_cannot_inject_formulas(self):
        from apps.parties.models import Distributor

        Distributor.objects.filter(pk=self.dist_local.pk).update(name="=HYPERLINK(1)")
        rows = self.csv_rows(self.get("distributors", export="csv"))
        self.assertTrue(any(r[0] == "'=HYPERLINK(1)" for r in rows))
