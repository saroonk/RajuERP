from decimal import Decimal

from apps.core.models import AuditLog
from apps.core.testing import TODAY
from apps.finance.models import Expense, ExpenseCategory, Payment

from .base import FinanceTestCase


class ExpenseTests(FinanceTestCase):
    def setUp(self):
        super().setUp()
        self.cat = ExpenseCategory.objects.create(name="Rent")

    def body(self, **over):
        b = {"date": str(TODAY), "categoryId": self.cat.pk, "payee": "Landlord", "description": "Warehouse rent", "amount": 45000, "mode": "bank_transfer"}
        b.update(over)
        return b

    def test_create_assigns_number_and_audits(self):
        res = self.client_as("accounts").post("/api/finance/expenses/", self.body(), format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertTrue(res.json()["expenseNo"].startswith("EXP-"))
        self.assertEqual(res.json()["categoryName"], "Rent")
        self.assertTrue(AuditLog.objects.filter(entity_type="Expense", action="create").exists())

    def test_update_and_delete(self):
        c = self.client_as("accounts")
        eid = c.post("/api/finance/expenses/", self.body(), format="json").json()["id"]
        up = c.put(f"/api/finance/expenses/{eid}/", self.body(amount=50000), format="json")
        self.assertEqual(up.status_code, 200)
        self.assertEqual(Expense.objects.get(pk=eid).amount, Decimal("50000.00"))
        self.assertEqual(c.delete(f"/api/finance/expenses/{eid}/").status_code, 204)
        self.assertFalse(Expense.objects.exists())

    def test_validation(self):
        c = self.client_as("accounts")
        self.assertEqual(c.post("/api/finance/expenses/", self.body(amount=0), format="json").status_code, 400)
        self.assertEqual(c.post("/api/finance/expenses/", self.body(amount=-10), format="json").status_code, 400)
        self.assertEqual(c.post("/api/finance/expenses/", self.body(payee="  "), format="json").status_code, 400)
        self.assertEqual(c.post("/api/finance/expenses/", self.body(categoryId=999), format="json").status_code, 400)
        self.assertEqual(c.post("/api/finance/expenses/", self.body(mode="gold"), format="json").status_code, 400)
        self.assertEqual(Expense.objects.count(), 0)

    def test_list_is_paginated_filterable_and_searchable(self):
        other = ExpenseCategory.objects.create(name="Fuel")
        c = self.client_as("accounts")
        for i in range(3):
            c.post("/api/finance/expenses/", self.body(payee=f"Landlord {i}"), format="json")
        c.post("/api/finance/expenses/", self.body(categoryId=other.pk, payee="Pump", amount=900), format="json")
        res = c.get("/api/finance/expenses/?page_size=2").json()
        self.assertEqual((res["count"], len(res["results"])), (4, 2))
        self.assertIsNotNone(res["next"])
        self.assertEqual(c.get(f"/api/finance/expenses/?category={other.pk}").json()["count"], 1)
        self.assertEqual(c.get("/api/finance/expenses/?search=Pump").json()["count"], 1)

    def test_category_in_use_cannot_be_deleted(self):
        c = self.client_as("accounts")
        c.post("/api/finance/expenses/", self.body(), format="json")
        res = c.delete(f"/api/expense-categories/{self.cat.pk}/")
        self.assertEqual(res.status_code, 409)
        self.assertIn("used by 1 expenses", res.json()["message"])
        free = ExpenseCategory.objects.create(name="Misc")
        self.assertEqual(c.delete(f"/api/expense-categories/{free.pk}/").status_code, 204)

    def test_category_names_are_unique(self):
        res = self.client_as("accounts").post("/api/expense-categories/", {"name": "Rent"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_permissions(self):
        self.assertEqual(self.client_as("warehouse").get("/api/finance/expenses/").status_code, 403)
        self.assertEqual(self.client_as("sales").post("/api/finance/expenses/", self.body(), format="json").status_code, 403)
        self.assertIn(self.client_as(None).get("/api/finance/expenses/").status_code, (401, 403))
        self.assertEqual(self.client_as("admin").post("/api/finance/expenses/", self.body(), format="json").status_code, 201)


class SummaryTests(FinanceTestCase):
    def test_income_and_expense_summary_figures(self):
        cat = ExpenseCategory.objects.create(name="Rent")
        inv = self.make_invoice()  # taxable 1000
        self.make_note(inv, "credit", taxable="100")
        self.make_note(inv, "debit", taxable="20", gst="0")
        self.make_grn(taxable="500", tax="90")
        self.make_supplier_return(taxable="50", tax="9")
        Expense.objects.create(expense_no="EXP-T-1", date=TODAY, category=cat, payee="L", amount=Decimal("300"), mode="cash")
        pay = Payment.objects.create(receipt_no="RCT-T-9", distributor=self.dist_local, date=TODAY, amount=Decimal("400"), mode="cash")
        self.assertTrue(pay.pk)
        self.make_supplier_payment("150")
        res = self.client_as("accounts").get("/api/finance/summary/")
        self.assertEqual(res.status_code, 200)
        s = res.json()
        self.assertEqual(
            (s["salesTaxable"], s["creditNotesTaxable"], s["debitNotesTaxable"], s["netIncome"]), (1000, 100, 20, 920)
        )
        self.assertEqual((s["purchasesTaxable"], s["supplierReturnsTaxable"], s["netPurchases"]), (500, 50, 450))
        self.assertEqual((s["totalExpenses"], s["operatingResult"]), (300, 170))  # 920 - 450 - 300
        self.assertEqual((s["collections"], s["supplierPayments"]), (400, 150))
        self.assertEqual(s["expensesByCategory"], [{"categoryId": cat.pk, "categoryName": "Rent", "amount": 300}])
        self.assertEqual(s["months"][-1], {"month": TODAY.strftime("%Y-%m"), "income": 920, "purchases": 450, "expenses": 300})

    def test_range_filters_and_validation(self):
        self.make_invoice()
        c = self.client_as("accounts")
        self.assertEqual(c.get("/api/finance/summary/?from=2000-01-01&to=2000-12-31").json()["salesTaxable"], 0)
        self.assertEqual(c.get("/api/finance/summary/?from=2026-02-01&to=2026-01-01").status_code, 400)
        self.assertEqual(c.get("/api/finance/summary/?from=nope").status_code, 400)
