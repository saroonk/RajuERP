"""
Populate the development database with realistic demo data.

Master data is created directly; ~5 months of activity (purchasing, receiving, ordering, dispatching,
invoicing, payments, returns, notes, write-offs, reconciliations) is then REPLAYED through the same domain
services the API uses, so every stock quantity, invoice total and balance is consistent by construction.
All names, GSTINs and contact details are fictitious. Mirrors frontend/src/services/mock/seed.ts.

    python manage.py seed_demo --password "<choose one>"      # or env SEED_DEMO_PASSWORD
    python manage.py seed_demo --flush                         # wipe business data first
"""

import os
import random
import secrets
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.catalog.models import Brand, Category, Product, Unit, UnitConversion
from apps.core.exceptions import DomainError
from apps.core.models import AuditLog, BackupRecord, DocumentSequence, Settings
from apps.core.audit import audit
from apps.core.numbering import next_doc_no
from apps.distribution import services as dist_svc
from apps.distribution.models import DistributionOrder, Dispatch, DistributorStockReport
from apps.finance import services as fin_svc
from apps.finance.models import Expense, ExpenseCategory, Payment
from apps.finance.selectors import distributor_balances, invoice_rows
from apps.inventory import services as inv_svc
from apps.inventory.models import Batch, Reconciliation, StockMovement, WriteOff
from apps.inventory.selectors import batch_stock_rows
from apps.parties.models import Distributor, DistributorPrice, Supplier
from apps.purchasing import services as pur_svc
from apps.purchasing.models import GoodsReceipt, PurchaseOrder, SupplierPayment, SupplierReturn
from apps.sales import services as sales_svc
from apps.sales.models import Invoice, NoteDocument, SalesReturn
from apps.users.models import User
from apps.users.permissions import ensure_default_permissions

# sku, name, brand, category, subcategory, pack unit, pack size, purchase, sell, gst, min stock, shelf life (days), hsn
PRODUCTS = [
    ("RC-TEA-250", "Raju's Choice Tea 250g", "raju", "bev", "tea", "box", 24, "78", "92", "5", 200, 540, "0902"),
    ("RC-COF-100", "Filter Coffee Powder 100g", "raju", "bev", "tea", "box", 24, "62", "74", "5", 150, 365, "0901"),
    ("RC-RICE-5K", "Sona Masuri Rice 5kg", "raju", "stp", "rice", "ctn", 4, "285", "320", "5", 100, 365, "1006"),
    ("RC-ATTA-5K", "Whole Wheat Atta 5kg", "raju", "stp", "rice", "ctn", 4, "195", "222", "5", 100, 120, "1101"),
    ("RC-OIL-1L", "Groundnut Oil 1L", "raju", "stp", "oil", "box", 12, "165", "188", "5", 150, 270, "1508"),
    ("RN-SOAP-100", "Neem Soap 100g", "naturals", "pc", "soap", "box", 12, "18", "24", "18", 400, 730, "3401"),
    ("RN-SOAP-SND", "Sandal Soap 100g", "naturals", "pc", "soap", "box", 12, "24", "32", "18", 300, 730, "3401"),
    ("RN-SHMP-180", "Herbal Shampoo 180ml", "naturals", "pc", "hair", "box", 12, "72", "95", "18", 200, 730, "3305"),
    ("RN-HOIL-200", "Coconut Hair Oil 200ml", "naturals", "pc", "hair", "box", 12, "64", "85", "18", 200, 730, "3305"),
    ("KF-BIS-MAR", "Marie Biscuits 100g", "kaveri", "snk", "bis", "case", 48, "8", "10.50", "18", 600, 180, "1905"),
    ("KF-BIS-CRM", "Cream Biscuits 75g", "kaveri", "snk", "bis", "case", 48, "9", "12", "18", 500, 150, "1905"),
    ("KF-NAM-MIX", "Mixture Namkeen 200g", "kaveri", "snk", "nam", "case", 24, "32", "42", "12", 250, 120, "2106"),
    ("KF-NAM-BHJ", "Aloo Bhujia 400g", "kaveri", "snk", "nam", "case", 24, "58", "76", "12", 200, 120, "2106"),
    ("KF-RUSK-200", "Wheat Rusk 200g", "kaveri", "snk", "bis", "case", 24, "28", "38", "18", 150, 120, "1905"),
    ("SB-JUC-1L", "Mango Juice 1L", "sunrise", "bev", "juice", "box", 12, "58", "78", "12", 200, 180, "2009"),
    ("SB-JUC-200", "Mixed Fruit Juice 200ml", "sunrise", "bev", "juice", "case", 24, "12", "17", "12", 400, 150, "2009"),
    ("SB-ICT-250", "Lemon Iced Tea 250ml", "sunrise", "bev", "tea", "case", 24, "18", "25", "12", 300, 180, "2202"),
    ("SB-WTR-1L", "Packaged Drinking Water 1L", "sunrise", "bev", "juice", "box", 12, "12", "18", "18", 500, 365, "2201"),
    ("FL-DET-1K", "Detergent Powder 1kg", "freshleaf", "hc", "det", "box", 10, "82", "108", "18", 200, 730, "3402"),
    ("FL-DISH-500", "Dishwash Liquid 500ml", "freshleaf", "hc", "det", "box", 12, "64", "88", "18", 200, 730, "3402"),
    ("FL-FLR-1L", "Floor Cleaner 1L", "freshleaf", "hc", "det", "box", 12, "92", "125", "18", 150, 730, "3402"),
    ("AW-HNY-500", "Pure Honey 500g", "aarogya", "stp", "well", "box", 12, "210", "285", "12", 100, 540, "0409"),
    ("AW-CHY-500", "Chyawanprash 500g", "aarogya", "stp", "well", "box", 12, "175", "240", "12", 80, 540, "2106"),
    ("AW-TULS-30", "Tulsi Drops 30ml", "aarogya", "stp", "well", "box", 24, "72", "110", "12", 60, 540, "3004"),
]

# name, type, person, city, state, credit limit, credit days, gstin, share of invoices paid in full, payment delay (days)
DISTRIBUTORS = [
    ("Sri Venkateshwara Distributors", "distributor", "S. Venkatesh", "Bengaluru", "Karnataka", 800000, 30, "29AAGFS1201D1Z3", 0.9, 5),
    ("Mysore Fresh Traders", "distributor", "K. Ramesh", "Mysuru", "Karnataka", 600000, 30, "29AAKFM4410E1Z7", 0.85, 8),
    ("Hubli Sri Traders", "distributor", "B. Patil", "Hubballi", "Karnataka", 60000, 21, "29AADFH7733B1Z1", 0.3, 20),
    ("Chennai Metro Distributors", "distributor", "R. Subramanian", "Chennai", "Tamil Nadu", 700000, 30, "33AAJFC5566G1Z5", 0.6, 22),
    ("Coimbatore Bharat Agencies", "dealer", "M. Kannan", "Coimbatore", "Tamil Nadu", 30000, 15, "33AAHFB2290H1Z9", 0.95, 2),
    ("Kochi Coastal Distributors", "distributor", "T. George", "Kochi", "Kerala", 500000, 30, "32AAFFK8812J1Z6", 0.55, 12),
    ("Hyderabad Deccan Traders", "distributor", "A. Reddy", "Hyderabad", "Telangana", 800000, 45, "36AAEFH3345K1Z0", 0.9, 6),
    ("Pune Sahyadri Agencies", "dealer", "V. Joshi", "Pune", "Maharashtra", 80000, 15, "27AAGFP9981L1Z2", 0.35, 25),
    ("Mangaluru Sea Breeze Stores", "dealer", "D. Shetty", "Mangaluru", "Karnataka", 120000, 15, "29AAIFM6624N1Z8", 0.95, 3),
    ("Vijayawada Krishna Distributors", "distributor", "P. Rao", "Vijayawada", "Andhra Pradesh", 400000, 30, "37AAHFV1178P1Z4", 0.7, 18),
]

SUPPLIERS = [
    ("Raju Agro Mills Pvt Ltd", "Venkatesh Gowda", "Mysuru", "Karnataka", "29AACCR7781K1Z2"),
    ("Naturals Manufacturing Co", "Lakshmi Narayanan", "Coimbatore", "Tamil Nadu", "33AAECN2210L1Z8"),
    ("Kaveri Foods Ltd", "Prakash Hegde", "Bengaluru", "Karnataka", "29AABCK5532M1Z4"),
    ("Sunrise Beverages Pvt Ltd", "Imran Sheikh", "Hyderabad", "Telangana", "36AAFCS9087Q1ZB"),
    ("FreshLeaf Home Care LLP", "Neha Kulkarni", "Pune", "Maharashtra", "27AAHFF3345P1Z6"),
    ("Aarogya Wellness Products", "Dr. Thomas Joseph", "Kochi", "Kerala", "32AAICA6612R1Z9"),
]
BRAND_KEYS = ["raju", "naturals", "kaveri", "sunrise", "freshleaf", "aarogya"]

EXPENSE_CATEGORIES = [
    "Rent", "Salaries", "Utilities", "Freight & Transport", "Fuel", "Warehouse Maintenance",
    "Marketing", "Office & Communication", "Miscellaneous",
]

USERS = [
    ("raju", "Raju Krishnan", "admin", True),
    ("anitha", "Anitha Shetty", "accounts", True),
    ("mahesh", "Mahesh Rao", "warehouse", True),
    ("suresh", "Suresh Naik", "sales", True),
    ("divya", "Divya Menon", "accounts", True),
    ("kiran", "Kiran Bhat", "warehouse", False),
]


class Command(BaseCommand):
    help = "Populate the database with realistic demo data by replaying activity through the real domain services."

    def add_arguments(self, parser):
        parser.add_argument("--flush", action="store_true", help="Delete existing business data first (keeps superusers and permissions).")
        parser.add_argument("--password", help="Password for the demo users (else env SEED_DEMO_PASSWORD, else a random one is generated and printed).")

    def handle(self, *args, **opts):
        if self._has_business_data() and not opts["flush"]:
            raise CommandError("The database already contains business data. Re-run with --flush to replace it.")
        password = opts["password"] or os.environ.get("SEED_DEMO_PASSWORD")
        generated = not password
        if generated:
            password = secrets.token_urlsafe(12)
        self.warnings: list[str] = []
        with transaction.atomic():
            if opts["flush"]:
                self._flush()
            self._seed(password)
        if generated:
            self.stdout.write(self.style.WARNING(f"Generated demo password (shown once): {password}"))
        self._summary()

    # ------------------------------------------------------------------ housekeeping

    @staticmethod
    def _has_business_data() -> bool:
        return Product.objects.exists() or Distributor.objects.exists() or Invoice.objects.exists()

    @staticmethod
    def _flush():
        # Children before parents (all FKs are PROTECT, so order matters).
        from apps.distribution.models import DispatchLine, OrderLine
        from apps.finance.models import PaymentAllocation
        from apps.inventory.models import ReconciliationLine, WriteOffLine
        from apps.purchasing.models import GRNLine, POLine, SupplierReturnLine
        from apps.sales.models import InvoiceLine, SalesReturnLine

        for model in (
            PaymentAllocation, Payment, NoteDocument, SalesReturnLine, SalesReturn, InvoiceLine, Invoice, DispatchLine, Dispatch,
            OrderLine, DistributionOrder, DistributorStockReport, StockMovement, WriteOffLine, WriteOff, ReconciliationLine,
            Reconciliation, SupplierReturnLine, SupplierReturn, SupplierPayment, GRNLine, Batch, GoodsReceipt, POLine, PurchaseOrder,
            DistributorPrice, Expense, ExpenseCategory, Product, Distributor, Supplier, UnitConversion, Unit, Category, Brand,
            BackupRecord, AuditLog, DocumentSequence,
        ):
            model.objects.all().delete()
        User.objects.filter(email__endswith="@rajuerp.demo").delete()

    # ------------------------------------------------------------------ seeding

    def _seed(self, password: str):
        T = timezone.localdate()
        rng = random.Random(20260615)
        ensure_default_permissions()

        s = Settings.load()
        s.company_name, s.gstin, s.state = "Raju Distributors Pvt Ltd", "29AABCR4521F1Z5", "Karnataka"
        s.address, s.phone, s.email = "14, Industrial Layout, Peenya, Bengaluru 560058", "+91 80 4000 1234", "accounts@rajuerp.demo"
        s.valuation_method, s.expiry_alert_days, s.default_credit_days = "fifo", 90, 30
        s.invoice_terms = (
            "Goods once sold will not be taken back except for expiry or damage, subject to prior approval. "
            "Payment due as per credit terms."
        )
        s.save()

        users = {}
        for key, name, role, active in USERS:
            users[key] = User.objects.create_user(email=f"{key}@rajuerp.demo", password=password, name=name, role=role, is_active=active)
        actor = {"admin": users["raju"], "accounts": users["anitha"], "warehouse": users["mahesh"], "sales": users["suresh"]}

        units = {c: Unit.objects.create(name=n, code=c) for c, n in
                 [("Pcs", "Pieces"), ("Box", "Box"), ("Ctn", "Carton"), ("Case", "Case"), ("Kg", "Kilogram"), ("Ltr", "Litre")]}
        for a, b, f in [("Box", "Pcs", 12), ("Ctn", "Box", 4), ("Case", "Pcs", 24), ("Ctn", "Pcs", 48)]:
            UnitConversion.objects.create(from_unit=units[a], to_unit=units[b], factor=f)
        unit_of = {"box": units["Box"], "ctn": units["Ctn"], "case": units["Case"]}

        brands = {}
        for key, name, kind, notes in [
            ("raju", "Raju's Choice", "own", "Packaged foods, company-owned"),
            ("naturals", "Sri Raju Naturals", "own", "Personal care, company-owned"),
            ("kaveri", "Kaveri Foods", "external", ""),
            ("sunrise", "Sunrise Beverages", "external", ""),
            ("freshleaf", "FreshLeaf Home Care", "external", ""),
            ("aarogya", "Aarogya Wellness", "external", ""),
        ]:
            brands[key] = Brand.objects.create(name=name, type=kind, notes=notes)

        cats = {}
        for key, name in [("bev", "Beverages"), ("snk", "Snacks & Biscuits"), ("stp", "Staples"), ("pc", "Personal Care"), ("hc", "Home Care")]:
            cats[key] = Category.objects.create(name=name)
        subs = {}
        for key, name, parent in [
            ("tea", "Tea & Coffee", "bev"), ("juice", "Juices & Water", "bev"), ("bis", "Biscuits", "snk"), ("nam", "Namkeen", "snk"),
            ("rice", "Rice & Flour", "stp"), ("oil", "Edible Oil", "stp"), ("well", "Wellness Foods", "stp"),
            ("soap", "Soaps", "pc"), ("hair", "Hair Care", "pc"), ("det", "Detergents & Cleaners", "hc"),
        ]:
            subs[key] = Category.objects.create(name=name, parent=cats[parent])

        products, shelf = [], {}
        for sku, name, brand, cat, sub, pack_unit, pack, buy, sell, gst, minimum, life, hsn in PRODUCTS:
            p = Product.objects.create(
                sku=sku, name=name, brand=brands[brand], category=cats[cat], subcategory=subs[sub], unit=units["Pcs"],
                pack_unit=unit_of[pack_unit], pack_size=pack, purchase_price=Decimal(buy), selling_price=Decimal(sell),
                gst_rate=Decimal(gst), hsn_code=hsn, min_stock=minimum,
            )
            products.append(p)
            shelf[p.pk] = life

        suppliers = [
            Supplier.objects.create(
                name=name, contact_person=person, phone=f"+91 98{rng.randint(10000000, 99999999)}",
                email=f"sales@{''.join(c for c in name.lower() if c.isalpha())[:14]}.demo", gstin=gstin,
                address=f"{rng.randint(1, 90)}, Industrial Estate", city=city, state=state,
            )
            for name, person, city, state, gstin in SUPPLIERS
        ]
        supplier_of_brand = {BRAND_KEYS[i]: suppliers[i] for i in range(6)}
        brand_key_of = {b.pk: k for k, b in brands.items()}

        distributors, behaviour = [], {}
        for i, (name, kind, person, city, state, limit, days, gstin, full, delay) in enumerate(DISTRIBUTORS, start=1):
            d = Distributor.objects.create(
                code=f"D{i:03d}", name=name, type=kind, contact_person=person, phone=f"+91 97{rng.randint(10000000, 99999999)}",
                email=f"{''.join(c if c.isalpha() else '.' for c in name.lower())[:20]}@mail.demo", gstin=gstin,
                address=f"{rng.randint(1, 120)}, Main Road", city=city, state=state, credit_limit=limit, credit_days=days,
                payment_terms=f"Net {days} days" if days <= 15 else f"Net {days} days, " + ("no cash discount" if kind == "dealer" else "1% cash discount within 7 days"),
            )
            distributors.append(d)
            behaviour[d.pk] = (full, delay)
        # Distributor-specific commercial terms for three large accounts.
        for dist_idx, mod in ((0, 0), (3, 1), (6, 2)):
            for i, p in enumerate(products):
                if i % 3 == mod:
                    disc = rng.choice([2, 3, 4, 5])
                    DistributorPrice.objects.create(distributor=distributors[dist_idx], product=p, price=p.selling_price, discount_pct=disc, terms=f"{disc}% trade discount")
        special = {(dp.distributor_id, dp.product_id): dp.discount_pct for dp in DistributorPrice.objects.all()}

        ecat = {n: ExpenseCategory.objects.create(name=n) for n in EXPENSE_CATEGORIES}

        # ------------------------------------------------------------------ timeline
        events: list[tuple] = []

        def at(date, role, fn):
            events.append((date, len(events), role, fn))

        batch_cache: dict[int, Batch] = {}

        def batch_obj(pk):
            if pk not in batch_cache:
                batch_cache[pk] = Batch.objects.get(pk=pk)
            return batch_cache[pk]

        low_stock = {"FL-FLR-1L", "AW-HNY-500", "RC-OIL-1L"}
        grn_of: dict[str, GoodsReceipt] = {}
        po_of: dict[str, int] = {}

        def round_pack(v, pack):
            return max(pack, round(v / pack) * pack)

        # Purchasing: 5 POs per supplier, received ~5 days later, paid ~a month after receipt.
        for si, supplier in enumerate(suppliers):
            mine = [p for p in products if supplier_of_brand[brand_key_of[p.brand_id]] == supplier]
            for k, off in enumerate([-148, -108, -68, -30, -12]):
                last = k == 4
                po_date = T + timedelta(days=off + si)
                if po_date >= T:
                    continue
                status = "draft" if last and si == 4 else "ordered"
                key = f"{supplier.pk}:{k}"
                lines = []
                for p in mine:
                    if p.sku in low_stock and k >= 3:
                        continue
                    base = rng.randint(140, 200) if p.sku in low_stock else rng.randint(380, 640)
                    lines.append({"product_id": p.pk, "qty": round_pack(base, p.pack_size), "rate": p.purchase_price, "gst_rate": p.gst_rate})

                def make_po(user, po_date=po_date, supplier=supplier, lines=lines, status=status, key=key):
                    po = pur_svc.create_po(user, {"supplier_id": supplier.pk, "date": po_date, "expected_date": po_date + timedelta(days=7),
                                                  "status": status, "notes": "", "lines": lines})
                    po_of[key] = po.pk

                at(po_date, "admin", make_po)
                grn_date = po_date + timedelta(days=rng.randint(4, 6))
                if status != "ordered" or (last and si == 3) or grn_date > T:
                    continue
                partial = last and si == 5

                def receive(user, po_key=key, grn_date=grn_date, partial=partial):
                    po = PurchaseOrder.objects.get(pk=po_of[po_key])
                    rows = []
                    for l in po.lines.select_related("product"):
                        p = l.product
                        mfg = grn_date - timedelta(days=rng.randint(4, 20))
                        qty = round_pack(l.qty * 0.6, p.pack_size) if partial else l.qty
                        rows.append({
                            "product_id": p.pk, "batch_no": f"{p.sku.split('-')[1]}-{grn_date:%y%m%d}", "mfg_date": mfg,
                            "expiry_date": mfg + timedelta(days=shelf[p.pk]), "qty": min(qty, l.qty),
                        })
                    grn_of[po_key] = pur_svc.receive_goods(user, {"po_id": po.pk, "date": grn_date, "supplier_invoice_no": f"SI/{rng.randint(1000, 9999)}", "lines": rows})

                at(grn_date, "warehouse", receive)
                pay_date = grn_date + timedelta(days=rng.randint(26, 36))
                if pay_date < T and not partial:
                    def pay_supplier(user, po_key=key, pay_date=pay_date, k=k, supplier=supplier):
                        grn = grn_of.get(po_key)
                        if grn is None:
                            return
                        amount = (grn.total * Decimal("0.5")).quantize(Decimal("0.01")) if k % 3 == 2 else grn.total
                        pur_svc.create_supplier_payment(user, {
                            "supplier_id": supplier.pk, "date": pay_date, "amount": amount,
                            "mode": rng.choice(["bank_transfer", "bank_transfer", "cheque", "upi"]), "reference": f"UTR{rng.randint(100000, 999999)}", "notes": "",
                        })

                    at(pay_date, "accounts", pay_supplier)

        # Orders, dispatches, invoices, payments
        dispatch_log: list[dict] = []
        for di, d in enumerate(distributors):
            full, delay = behaviour[d.pk]
            date = T + timedelta(days=-133 + rng.randint(0, 8))
            while date <= T - timedelta(days=2):
                order_date = date
                chosen = rng.sample(products, rng.randint(3, 6))
                lines = []
                for p in chosen:
                    big = rng.randint(1, 4) if p.pack_size >= 24 else rng.randint(1, 6)
                    lines.append({"product": p, "qty": min(288, p.pack_size * big), "rate": p.selling_price,
                                  "discount_pct": special.get((d.pk, p.pk), Decimal(0))})
                recent = order_date > T - timedelta(days=6)
                holder: dict = {}
                as_draft = recent and rng.random() < 0.2

                def make_order(user, d=d, order_date=order_date, lines=lines, as_draft=as_draft, holder=holder):
                    holder["order"] = dist_svc.create_order(user, {"distributor": d, "date": order_date, "expected_date": order_date + timedelta(days=3),
                                                                  "notes": "", "status": "draft" if as_draft else "confirmed", "lines": lines})

                at(order_date, "sales", make_order)
                dispatch_now = (not recent) or rng.random() < 0.4
                if not as_draft and dispatch_now:
                    partial_first = rng.random() < 0.1

                    def plan(d_date, fraction, invoice, holder=holder, d=d, full=full, delay=delay):
                        if d_date > T:
                            return
                        log = {"date": d_date, "distributor": d, "invoice": None, "dispatch": None}
                        dispatch_log.append(log)

                        def dispatch(user):
                            order = DistributionOrder.objects.get(pk=holder["order"].pk)
                            pending = dist_svc._pending_by_product(order)
                            lines_out, used = [], {}
                            for product_id, left in pending.items():
                                p = next(x for x in products if x.pk == product_id)
                                want = left if fraction >= 1 else max(p.pack_size, int(left * fraction / p.pack_size) * p.pack_size)
                                want = min(want, left)
                                if want <= 0:
                                    continue
                                for a in inv_svc.suggest_allocation(product_id, want, d_date, used):
                                    lines_out.append({"product": p, "batch": batch_obj(a["batch_id"]), "qty": a["qty"]})
                                    used[a["batch_id"]] = used.get(a["batch_id"], 0) + a["qty"]
                            if not lines_out:
                                return
                            disp = dist_svc.create_dispatch(user, {
                                "order": order, "date": d_date, "vehicle_no": f"KA-0{rng.randint(1, 9)}-{rng.choice(['AB', 'CD', 'EF', 'MN'])}-{rng.randint(1000, 9999)}",
                                "delivery_ref": f"DC-{rng.randint(10000, 99999)}", "notes": "", "lines": lines_out,
                            })
                            log["dispatch"] = disp
                            if invoice:
                                log["invoice"] = sales_svc.create_invoice_from_dispatch(actor["accounts"], disp.pk, d_date)

                        at(d_date, "warehouse", dispatch)
                        if not invoice:
                            return
                        pay_date = d_date + timedelta(days=d.credit_days + rng.randint(min(0, delay - 6), delay))
                        if pay_date >= T:
                            return
                        roll = rng.random()
                        if roll > full + (1 - full) * 0.5:
                            return  # leaves some invoices unpaid
                        pay_mode = rng.choice(["bank_transfer", "bank_transfer", "upi", "cheque", "cash"])
                        ref = f"REF{rng.randint(100000, 999999)}"
                        frac = 0.3 + rng.random() * 0.4

                        def pay(user):
                            if not log["invoice"]:
                                return
                            row = invoice_rows(Invoice.objects.filter(pk=log["invoice"].pk))[0]
                            outstanding = row["outstanding"]
                            if outstanding <= 0:
                                return
                            if roll <= full:
                                amount = outstanding
                            else:
                                amount = max(Decimal(500), (outstanding * Decimal(str(frac)) / 100).quantize(Decimal("1")) * 100)
                                amount = min(amount, outstanding)
                            fin_svc.create_payment(user, distributor=d, date=pay_date, amount=amount, mode=pay_mode, reference=ref,
                                                   notes="" if roll <= full else "Part payment",
                                                   allocations=[{"invoice_id": log["invoice"].pk, "amount": amount}])

                        at(pay_date, "accounts", pay)

                    d1 = order_date + timedelta(days=rng.randint(1, 2))
                    invoice_it = not (order_date > T - timedelta(days=4) and rng.random() < 0.5)
                    if partial_first:
                        plan(d1, 0.6, True)
                        plan(d1 + timedelta(days=4), 1, True)
                    else:
                        plan(d1, 1, invoice_it)
                date = date + timedelta(days=rng.randint(9, 17) + di % 3)

        # Returns and notes
        def candidates():
            return [l for l in dispatch_log if l["invoice"] and l["date"] <= T - timedelta(days=14)]

        plans = [("expired", "expired"), ("damaged", "damaged"), ("near_expiry", "saleable"), ("quality_issue", "inspection"),
                 ("quality_issue", "inspection"), ("damaged", "damaged"), ("expired", "expired")]
        for i, (reason, cls) in enumerate(plans):
            r_date = T + timedelta(days=-75 + i * 9)

            def make_return(user, i=i, reason=reason, cls=cls, r_date=r_date):
                pool = [l for l in candidates() if l["invoice"].date < r_date - timedelta(days=5)]
                if not pool:
                    return
                inv = rng.choice(pool)["invoice"]
                room = next((x for x in sales_svc.returnable_lines(inv.pk) if x["remaining"] >= 6), None)
                if not room:
                    return
                qty = min(room["remaining"], rng.randint(6, 24))
                ret = sales_svc.create_sales_return(user, {
                    "invoice": inv, "date": r_date, "reason": reason, "notes": "", "issue_credit_note": i != 4,
                    "lines": [{"product": Product.objects.get(pk=room["product_id"]), "batch": batch_obj(room["batch_id"]), "qty": qty, "classification": cls}],
                })
                if i == 3:
                    sales_svc.reclassify_return_line(user, ret.pk, 0, "damaged", "Packaging leak confirmed on inspection")

            at(r_date, "warehouse", make_return)

        def credit_note(user):
            l = next((x for x in candidates()), None)
            if l:
                sales_svc.create_note(user, {"type": "credit", "distributor": l["distributor"], "invoice": l["invoice"], "date": T - timedelta(days=21),
                                             "reason": "Rate difference adjustment", "taxable": Decimal("850"), "gst_rate": Decimal("18")})

        def debit_note(user):
            rows = candidates()
            if len(rows) > 3:
                l = rows[3]
                sales_svc.create_note(user, {"type": "debit", "distributor": l["distributor"], "invoice": l["invoice"], "date": T - timedelta(days=12),
                                             "reason": "Freight recovery", "taxable": Decimal("1200"), "gst_rate": Decimal("18")})

        at(T - timedelta(days=21), "accounts", credit_note)
        at(T - timedelta(days=12), "accounts", debit_note)

        # Write-off, supplier return, reconciliations
        def write_off(user):
            lines = [{"batch_id": b["id"], "bucket": "saleable", "qty": b["saleable"]}
                     for b in batch_stock_rows() if b["expiry_date"] < T - timedelta(days=30) and b["saleable"] > 0]
            if lines:
                inv_svc.create_write_off(user, {"date": T - timedelta(days=18), "reason": "Expired stock disposal", "lines": lines})

        at(T - timedelta(days=18), "warehouse", write_off)

        def supplier_return(user):
            b = next((x for x in batch_stock_rows() if x["supplier_id"] == suppliers[2].pk and x["saleable"] >= 40 and x["days_to_expiry"] > 0), None)
            if b:
                pur_svc.create_supplier_return(user, {"supplier_id": b["supplier_id"], "date": T - timedelta(days=40), "reason": "Short shelf life on delivery",
                                                      "lines": [{"batch_id": b["id"], "bucket": "saleable", "qty": 24}]})

        at(T - timedelta(days=40), "warehouse", supplier_return)

        def approved_count(user):
            rows = [b for b in batch_stock_rows() if b["saleable"] > 60 and b["days_to_expiry"] > 0][:6]
            rec = inv_svc.create_reconciliation(user, {"date": T - timedelta(days=35), "notes": "Monthly cycle count",
                                                       "lines": [{"batch_id": b["id"], "physical_qty": b["saleable"] + [0, -2, 1, 0, -5, 0][i]} for i, b in enumerate(rows)]})
            inv_svc.approve_reconciliation(actor["admin"], rec.pk)

        def draft_count(user):
            rows = [b for b in batch_stock_rows() if b["saleable"] > 40 and b["days_to_expiry"] > 30][6:10]
            if rows:
                inv_svc.create_reconciliation(user, {"date": T - timedelta(days=2), "notes": "Spot check - fast moving items",
                                                     "lines": [{"batch_id": b["id"], "physical_qty": max(0, b["saleable"] - [3, 0, 12, 1][i])} for i, b in enumerate(rows)]})

        at(T - timedelta(days=35), "warehouse", approved_count)
        at(T - timedelta(days=2), "warehouse", draft_count)

        # Unallocated advance, a rusk delivery that outlives its shelf life, open/draft/cancelled orders, uninvoiced dispatch
        at(T - timedelta(days=6), "accounts", lambda user: fin_svc.create_payment(
            user, distributor=distributors[6], date=T - timedelta(days=6), amount=Decimal("50000"), mode="bank_transfer",
            reference="UTR778812", notes="Advance, to be allocated", allocations=[]))

        def festive_rusk(user):
            p = next(x for x in products if x.sku == "KF-RUSK-200")
            d0 = T - timedelta(days=104)
            po = pur_svc.create_po(user, {"supplier_id": suppliers[2].pk, "date": d0, "expected_date": d0 + timedelta(days=5), "status": "ordered", "notes": "Festive stocking",
                                          "lines": [{"product_id": p.pk, "qty": 1200, "rate": p.purchase_price, "gst_rate": p.gst_rate}]})
            pur_svc.receive_goods(actor["warehouse"], {"po_id": po.pk, "date": T - timedelta(days=99), "supplier_invoice_no": "SI/7788",
                                                       "lines": [{"product_id": p.pk, "batch_no": "RUSK-FEST", "mfg_date": T - timedelta(days=140),
                                                                  "expiry_date": T - timedelta(days=20), "qty": 1200}]})

        at(T - timedelta(days=104), "admin", festive_rusk)

        for idx, (d_idx, ago) in enumerate([(0, 2), (3, 1), (6, 1), (1, 3)]):
            o_date = T - timedelta(days=ago)

            def open_order(user, d_idx=d_idx, o_date=o_date, idx=idx):
                picks = [p for i, p in enumerate(products) if (i + idx * 5) % 6 == 0][:4]
                dist_svc.create_order(user, {"distributor": distributors[d_idx], "date": o_date, "expected_date": o_date + timedelta(days=3), "notes": "", "status": "confirmed",
                                             "lines": [{"product": p, "qty": p.pack_size * 3, "rate": p.selling_price, "discount_pct": Decimal(0)} for p in picks]})

            at(o_date, "sales", open_order)

        def uninvoiced_dispatch(user):
            order = DistributionOrder.objects.filter(distributor=distributors[0], status="confirmed").order_by("-id").first()
            if not order:
                return
            d1 = T - timedelta(days=1)
            lines = []
            for l in order.lines.select_related("product"):
                for a in inv_svc.suggest_allocation(l.product_id, l.qty, d1):
                    lines.append({"product": l.product, "batch": batch_obj(a["batch_id"]), "qty": a["qty"]})
            dist_svc.create_dispatch(user, {"order": order, "date": d1, "vehicle_no": "KA-05-MN-4821", "delivery_ref": "DC-88231", "notes": "Invoice to follow", "lines": lines})

        at(T - timedelta(days=1), "warehouse", uninvoiced_dispatch)
        at(T - timedelta(days=1), "sales", lambda user: dist_svc.create_order(user, {
            "distributor": distributors[8], "date": T - timedelta(days=1), "expected_date": None, "notes": "Awaiting confirmation", "status": "draft",
            "lines": [{"product": p, "qty": p.pack_size * 2, "rate": p.selling_price, "discount_pct": Decimal(0)} for p in products[8:11]]}))

        def cancelled_order(user):
            p = products[2]
            o = dist_svc.create_order(user, {"distributor": distributors[5], "date": T - timedelta(days=40), "expected_date": None, "notes": "Customer postponed",
                                             "status": "confirmed", "lines": [{"product": p, "qty": 96, "rate": p.selling_price, "discount_pct": Decimal(0)}]})
            dist_svc.set_order_status(user, o.pk, "cancelled")

        at(T - timedelta(days=40), "sales", cancelled_order)

        # ------------------------------------------------------------------ replay
        events.sort(key=lambda e: (e[0], e[1]))
        last_audit = AuditLog.objects.order_by("-id").values_list("id", flat=True).first() or 0
        for date, _seq, role, fn in events:
            sid = transaction.savepoint()
            try:
                fn(actor[role])
                transaction.savepoint_commit(sid)
            except DomainError as e:
                transaction.savepoint_rollback(sid)
                self.warnings.append(f"{date}: {e.message}")
                continue
            # Back-date the audit entries written by this event to the event's date.
            stamp = timezone.make_aware(datetime.combine(date, time(10, 30)))
            AuditLog.objects.filter(pk__gt=last_audit).update(at=stamp)
            last_audit = AuditLog.objects.order_by("-id").values_list("id", flat=True).first() or last_audit

        # ------------------------------------------------------------------ expenses, reports, backups
        months = []
        for back in (4, 3, 2, 1, 0):
            y, m = T.year, T.month - back
            while m <= 0:
                m += 12
                y -= 1
            months.append((y, m))

        def add_expense(day_date, cat, payee, description, amount, mode):
            if day_date > T:
                return
            Expense.objects.create(expense_no=next_doc_no("expense", day_date), date=day_date, category=ecat[cat], payee=payee,
                                   description=description, amount=Decimal(str(amount)), mode=mode)

        from datetime import date as date_cls

        for y, m in months:
            def day(n):
                return date_cls(y, m, n)
            add_expense(day(1), "Rent", "Peenya Warehousing Co", "Warehouse rent", 45000, "bank_transfer")
            add_expense(day(3), "Salaries", "Staff payroll", "Monthly salaries", rng.randint(205000, 215000), "bank_transfer")
            add_expense(day(8), "Utilities", "BESCOM", "Electricity bill", rng.randint(17000, 24000), "upi")
            add_expense(day(10), "Freight & Transport", "Sri Ganesh Transport", "Outbound freight", rng.randint(22000, 41000), "bank_transfer")
            add_expense(day(17), "Freight & Transport", "VRL Logistics", "Inter-state freight", rng.randint(12000, 26000), "bank_transfer")
            add_expense(day(12), "Fuel", "HP Petrol Pump", "Delivery vehicle fuel", rng.randint(8000, 14000), "cash")
            add_expense(day(14), "Office & Communication", "Airtel", "Internet and phones", 3200, "upi")
            add_expense(day(20), "Warehouse Maintenance", rng.choice(["Ravi Maintenance", "Pest Control India", "Safety First Services"]), "Maintenance and pest control", rng.randint(2500, 9500), "cash")
            if rng.random() < 0.6:
                add_expense(day(24), "Marketing", "Signboard Studio", "Dealer boards and flyers", rng.randint(6000, 18000), "bank_transfer")
            if rng.random() < 0.5:
                add_expense(day(26), "Miscellaneous", "Various", "Sundry expenses", rng.randint(1200, 4800), "cash")

        # Distributor-reported stock (imported) for the largest accounts, derived from what was dispatched to them.
        period = (T.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
        rows = [["distributorCode", "sku", "period", "reportedSales", "remainingStock", "returned"]]
        for d in (distributors[0], distributors[1], distributors[3], distributors[6]):
            dispatched: dict[int, int] = {}
            for disp in Dispatch.objects.filter(distributor=d).prefetch_related("lines"):
                for l in disp.lines.all():
                    dispatched[l.product_id] = dispatched.get(l.product_id, 0) + l.qty
            for product_id, qty in list(dispatched.items())[:6]:
                sku = next(p.sku for p in products if p.pk == product_id)
                rows.append([d.code, sku, period, str(int(qty * 0.72)), str(int(qty * 0.2)), "0"])
        dist_svc.import_stock_reports(actor["admin"], rows)

        for i in range(6):
            BackupRecord.objects.create(date=T - timedelta(days=i * 7 + 2), time="02:00", type="scheduled", size_mb=Decimal(str(round(38 + i * 0.4 + rng.random(), 2))),
                                        status="failed" if i == 3 else "completed")
        audit(actor["admin"], "other", "System", "Seed", "Demo data loaded")

    # ------------------------------------------------------------------ report

    def _summary(self):
        counts = [
            ("Products", Product.objects.count()), ("Suppliers", Supplier.objects.count()), ("Distributors", Distributor.objects.count()),
            ("Purchase orders", PurchaseOrder.objects.count()), ("Goods receipts", GoodsReceipt.objects.count()), ("Batches", Batch.objects.count()),
            ("Stock movements", StockMovement.objects.count()), ("Orders", DistributionOrder.objects.count()), ("Dispatches", Dispatch.objects.count()),
            ("Invoices", Invoice.objects.count()), ("Payments", Payment.objects.count()), ("Credit/debit notes", NoteDocument.objects.count()),
            ("Sales returns", SalesReturn.objects.count()), ("Write-offs", WriteOff.objects.count()), ("Reconciliations", Reconciliation.objects.count()),
            ("Supplier returns", SupplierReturn.objects.count()), ("Supplier payments", SupplierPayment.objects.count()),
            ("Expenses", Expense.objects.count()), ("Stock reports", DistributorStockReport.objects.count()), ("Audit entries", AuditLog.objects.count()),
        ]
        self.stdout.write(self.style.SUCCESS("Demo data created:"))
        for label, n in counts:
            self.stdout.write(f"  {label:<20}{n}")
        self.stdout.write(f"  Skipped events: {len(self.warnings)}")
        for w in self.warnings[:10]:
            self.stdout.write(f"    - {w}")
        over = [b["distributor_name"] for b in distributor_balances() if b["over_limit"]]
        if over:
            self.stdout.write(f"  Over credit limit: {', '.join(over)}")
