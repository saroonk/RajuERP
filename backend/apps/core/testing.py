"""Shared test helpers: users per role, API client, and small factories for master data and stock."""

from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from apps.catalog.models import Brand, Category, Product, Unit
from apps.core.models import Settings
from apps.inventory.models import Batch
from apps.inventory.stock import post_movement
from apps.parties.models import Distributor, Supplier
from apps.users.models import User
from apps.users.permissions import ensure_default_permissions

TODAY = date.today()


class ERPTestCase(TestCase):
    """
    Base class. Provides `self.users[role]`, `self.client_as(role)` and `self.world` (master data).
    Company state is Karnataka: `self.dist_local` (Karnataka) gets CGST+SGST, `self.dist_other` (Tamil Nadu) gets IGST.
    """

    def setUp(self):
        ensure_default_permissions()
        s = Settings.load()
        s.company_name, s.state, s.gstin = "Test Co", "Karnataka", "29AABCT1234F1Z5"
        s.save()
        self.users = {
            role: User.objects.create_user(email=f"{role}@test.local", password="s3cret-Pass!", name=role.title(), role=role)
            for role in ("admin", "accounts", "warehouse", "sales")
        }
        unit = Unit.objects.create(name="Pieces", code="Pcs")
        box = Unit.objects.create(name="Box", code="Box")
        brand = Brand.objects.create(name="Test Brand", type="own")
        cat = Category.objects.create(name="Snacks")
        self.product = Product.objects.create(
            sku="SKU-1", name="Biscuit 100g", brand=brand, category=cat, unit=unit, pack_unit=box, pack_size=12,
            purchase_price=Decimal("10.00"), selling_price=Decimal("15.00"), gst_rate=Decimal("18.00"), min_stock=20,
        )
        self.product2 = Product.objects.create(
            sku="SKU-2", name="Tea 250g", brand=brand, category=cat, unit=unit, pack_unit=box, pack_size=12,
            purchase_price=Decimal("80.00"), selling_price=Decimal("100.00"), gst_rate=Decimal("5.00"), min_stock=10,
        )
        self.supplier = Supplier.objects.create(name="Supplier One", state="Karnataka", gstin="29AAACS1111A1Z1")
        self.dist_local = Distributor.objects.create(code="D001", name="Local Traders", state="Karnataka", credit_limit=Decimal("100000"), credit_days=30)
        self.dist_other = Distributor.objects.create(code="D002", name="Chennai Traders", state="Tamil Nadu", credit_limit=Decimal("100000"), credit_days=30)

    def client_as(self, role: str | None) -> APIClient:
        c = APIClient()
        if role:
            c.force_login(self.users[role])
        return c

    def make_batch(self, product=None, qty=100, batch_no="B-1", days_to_expiry=200, cost=Decimal("10.00"), received_on=None) -> Batch:
        """A batch with `qty` saleable units, created through the stock ledger (as a goods receipt would)."""
        product = product or self.product
        received_on = received_on or TODAY - timedelta(days=10)
        batch = Batch.objects.create(
            product=product, batch_no=batch_no, mfg_date=received_on - timedelta(days=5), expiry_date=TODAY + timedelta(days=days_to_expiry),
            received_qty=qty, cost_price=cost, supplier=self.supplier, received_on=received_on,
        )
        post_movement(user=None, date=received_on, batch=batch, type="receipt", bucket="saleable", qty=qty, ref_type="Test", ref_id=None, ref_no="T-0")
        return batch

    @staticmethod
    def data(response):
        """Response body, flattening a paginated {results: [...]} envelope."""
        body = response.json()
        return body["results"] if isinstance(body, dict) and "results" in body else body
