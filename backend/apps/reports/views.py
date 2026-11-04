from django.db.models import Q
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalog.models import Brand, Category, Product, Unit
from apps.core.csv_export import csv_response
from apps.core.permissions import has_module_level
from apps.finance.models import ExpenseCategory, Payment
from apps.finance.ranges import parse_range
from apps.inventory.models import Batch
from apps.inventory.stock import bucket_map
from apps.parties.models import Distributor, Supplier
from apps.sales.models import Invoice

from . import selectors


class ReportView(APIView):
    """JSON by default, CSV with `?export=csv` (same rows and totals). Reports return the full aggregate, not pages."""

    permission_module = "reports"
    filename = "report"
    csv_headers: list[str] = []

    def build(self, frm, to):  # pragma: no cover - overridden
        raise NotImplementedError

    def csv_rows(self, data) -> list[list]:
        return [[r[k] for k in self.keys] for r in data]

    def get(self, request):
        frm, to = parse_range(request)
        data = self.build(frm, to)
        if request.query_params.get("export") == "csv":
            return csv_response(f"{self.filename}_{frm}_{to}", self.csv_headers, self.csv_rows(data))
        return Response(data)


class SalesProfitabilityView(ReportView):
    filename = "sales-profitability"
    csv_headers = ["Invoice no", "Date", "Distributor", "Revenue", "Cost", "Margin", "Margin %"]
    keys = ["invoice_no", "date", "distributor_name", "revenue", "cost", "margin", "margin_pct"]

    def build(self, frm, to):
        return selectors.sales_profitability(frm, to)

    def csv_rows(self, data):
        return [[r[k] for k in self.keys] for r in data["rows"]]


class BrandReportView(ReportView):
    filename = "brand-report"
    csv_headers = ["Brand", "Type", "Qty sold", "Revenue", "Cost", "Margin", "Margin %", "Stock qty", "Stock value"]
    keys = ["brand_name", "type", "qty_sold", "revenue", "cost", "margin", "margin_pct", "stock_qty", "stock_value"]

    def build(self, frm, to):
        return selectors.brand_report(frm, to)


class ProductReportView(ReportView):
    filename = "product-performance"
    csv_headers = ["SKU", "Product", "Brand", "Qty sold", "Revenue", "Margin", "Stock on hand", "Last sale", "Classification"]
    keys = ["sku", "name", "brand_name", "qty_sold", "revenue", "margin", "stock_on_hand", "last_sale_date", "classification"]

    def build(self, frm, to):
        return selectors.product_report(frm, to)


class DistributorReportView(ReportView):
    filename = "distributor-performance"
    csv_headers = ["Distributor", "Type", "Invoices", "Taxable sales", "Invoiced", "Collected", "Outstanding", "Returns value", "Return %", "Reported sales"]
    keys = ["distributor_name", "type", "invoices", "taxable", "invoiced", "collected", "outstanding", "returns_value", "return_pct", "reported_sales"]

    def build(self, frm, to):
        return selectors.distributor_report(frm, to)


class PurchaseRegisterView(ReportView):
    filename = "purchase-register"
    csv_headers = ["GRN no", "Date", "Supplier", "GSTIN", "Supplier invoice", "Taxable", "CGST", "SGST", "IGST", "Total"]
    keys = ["grn_no", "date", "supplier_name", "gstin", "supplier_invoice_no", "taxable", "cgst", "sgst", "igst", "total"]

    def build(self, frm, to):
        return selectors.purchase_register(frm, to)


class SalesRegisterView(ReportView):
    filename = "sales-register"
    csv_headers = ["Invoice no", "Date", "Distributor", "GSTIN", "Taxable", "CGST", "SGST", "IGST", "Round off", "Total"]
    keys = ["invoice_no", "date", "distributor_name", "gstin", "taxable", "cgst", "sgst", "igst", "round_off", "total"]

    def build(self, frm, to):
        return selectors.sales_register(frm, to)


class GstSummaryView(ReportView):
    filename = "gst-summary"
    csv_headers = ["Section", "Rate / month", "Taxable", "CGST", "SGST", "IGST", "Tax"]

    def build(self, frm, to):
        return selectors.gst_summary(frm, to)

    def csv_rows(self, data):
        rows = [["By GST rate", f"{r['rate']}%", r["taxable"], r["cgst"], r["sgst"], r["igst"], r["tax"]] for r in data["by_rate"]]
        rows += [["By month", r["month"], r["taxable"], "", "", "", r["tax"]] for r in data["by_month"]]
        o = data["output"]
        rows.append(["Output total", "", o["taxable"], o["cgst"], o["sgst"], o["igst"], o["tax"]])
        return rows


class DashboardView(APIView):
    permission_module = "dashboard"

    def get(self, request):
        return Response(selectors.dashboard())


def _rows(qs, *fields):
    return list(qs.values("id", *fields))


class LookupsView(APIView):
    """Master data every screen needs to render names and dropdowns. Any signed-in user."""

    permission_module = None

    def get(self, request):
        return Response(
            {
                "brands": _rows(Brand.objects.order_by("name"), "name", "type", "active", "notes"),
                "categories": _rows(Category.objects.order_by("name"), "name", "parent_id", "active"),
                "units": _rows(Unit.objects.order_by("id"), "name", "code"),
                "products": _rows(
                    Product.objects.order_by("name"),
                    "sku", "name", "brand_id", "category_id", "subcategory_id", "unit_id", "pack_unit_id", "pack_size",
                    "purchase_price", "selling_price", "gst_rate", "hsn_code", "min_stock", "active",
                ),
                "suppliers": _rows(
                    Supplier.objects.order_by("name"), "name", "contact_person", "phone", "email", "gstin", "address", "city", "state", "active"
                ),
                "distributors": _rows(
                    Distributor.objects.order_by("name"),
                    "code", "name", "type", "contact_person", "phone", "email", "gstin", "address", "city", "state",
                    "credit_limit", "credit_days", "payment_terms", "active",
                ),
                "expense_categories": _rows(ExpenseCategory.objects.order_by("name"), "name"),
            }
        )


class SearchView(APIView):
    """Header search. Each entity type is searched only if the requester may view its module."""

    permission_module = None

    def get(self, request):
        term = (request.query_params.get("q") or "").strip()
        if len(term) < 2:
            return Response([])
        u = request.user
        out: list[dict] = []

        def add(type_, label, sub, href):
            out.append({"type": type_, "label": label, "sub": sub, "href": href})

        if has_module_level(u, "products", "view"):
            for p in Product.objects.filter(Q(name__icontains=term) | Q(sku__icontains=term))[:4]:
                add("Product", p.name, p.sku, "/products")
        if has_module_level(u, "inventory", "view"):
            batches = list(Batch.objects.filter(Q(batch_no__icontains=term) | Q(product__name__icontains=term)).select_related("product")[:4])
            q = bucket_map(b.pk for b in batches)
            for b in batches:
                add("Batch", f"{b.batch_no} · {b.product.name}", f"{q[b.pk]['saleable'] if b.pk in q else 0} saleable", "/inventory/batches")
        if has_module_level(u, "sales", "view"):
            for i in Invoice.objects.filter(Q(invoice_no__icontains=term) | Q(distributor__name__icontains=term)).select_related("distributor")[:4]:
                add("Invoice", i.invoice_no, i.distributor.name, f"/sales/invoices/{i.pk}")
        if has_module_level(u, "purchases", "view"):
            for s in Supplier.objects.filter(Q(name__icontains=term) | Q(gstin__icontains=term) | Q(city__icontains=term))[:4]:
                add("Supplier", s.name, s.city, "/purchases/suppliers")
            from apps.purchasing.models import PurchaseOrder

            for p in PurchaseOrder.objects.filter(po_no__icontains=term).select_related("supplier")[:4]:
                add("Purchase order", p.po_no, p.supplier.name, f"/purchases/orders/{p.pk}")
        if has_module_level(u, "distributors", "view"):
            for d in Distributor.objects.filter(Q(name__icontains=term) | Q(code__icontains=term) | Q(gstin__icontains=term) | Q(city__icontains=term))[:4]:
                add("Distributor", d.name, f"{d.code} · {d.city}", f"/distribution/distributors/{d.pk}")
        if has_module_level(u, "distribution", "view"):
            from apps.distribution.models import DistributionOrder

            for o in DistributionOrder.objects.filter(order_no__icontains=term).select_related("distributor")[:4]:
                add("Order", o.order_no, o.distributor.name, f"/distribution/orders/{o.pk}")
        if has_module_level(u, "receivables", "view"):
            for p in Payment.objects.filter(Q(receipt_no__icontains=term) | Q(reference__icontains=term)).select_related("distributor")[:4]:
                add("Payment", p.receipt_no, p.distributor.name, f"/accounts/payments/{p.pk}")
        return Response(out)
