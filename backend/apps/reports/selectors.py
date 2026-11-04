"""Report calculations over real records. Figures are net of returns and use Decimal throughout."""

import math
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Max, Sum
from django.utils import timezone

from apps.catalog.models import Brand, Product
from apps.core.models import Settings
from apps.core.money import ZERO, q2
from apps.finance import selectors as fin
from apps.finance.models import Payment
from apps.finance.ranges import month_key
from apps.inventory.selectors import batch_stock_rows, product_stock_rows
from apps.parties.models import Distributor
from apps.purchasing.models import GoodsReceipt, SupplierReturn
from apps.sales.models import Invoice, InvoiceLine, NoteDocument, SalesReturn, SalesReturnLine


def sales_facts(frm, to) -> list[dict]:
    """
    One fact per invoice line (positive) and per returned line (negative), dated by their own document date.
    Returned goods reverse cost only when they went back into saleable stock.
    """
    facts = []
    lines = InvoiceLine.objects.filter(invoice__date__gte=frm, invoice__date__lte=to).values(
        "invoice_id", "invoice__date", "invoice__distributor_id", "product_id", "product__brand_id", "qty", "taxable", "unit_cost"
    )
    for l in lines:
        facts.append(
            {
                "date": l["invoice__date"],
                "invoice_id": l["invoice_id"],
                "distributor_id": l["invoice__distributor_id"],
                "product_id": l["product_id"],
                "brand_id": l["product__brand_id"],
                "qty": l["qty"],
                "taxable": l["taxable"],
                "cost": q2(l["qty"] * l["unit_cost"]),
            }
        )
    rets = SalesReturnLine.objects.filter(sales_return__date__gte=frm, sales_return__date__lte=to).values(
        "sales_return__invoice_id", "sales_return__date", "sales_return__distributor_id", "product_id", "product__brand_id",
        "qty", "rate", "discount_pct", "unit_cost", "classification",
    )
    for l in rets:
        facts.append(
            {
                "date": l["sales_return__date"],
                "invoice_id": l["sales_return__invoice_id"],
                "distributor_id": l["sales_return__distributor_id"],
                "product_id": l["product_id"],
                "brand_id": l["product__brand_id"],
                "qty": -l["qty"],
                "taxable": -q2(l["qty"] * l["rate"] * (1 - l["discount_pct"] / 100)),
                "cost": -q2(l["qty"] * l["unit_cost"]) if l["classification"] == "saleable" else ZERO,
            }
        )
    return facts


def _pct(margin, revenue):
    return q2(margin / revenue * 100) if revenue else ZERO


def sales_profitability(frm, to) -> dict:
    facts = sales_facts(frm, to)
    acc: dict[int, dict] = {}
    for f in facts:
        r = acc.setdefault(f["invoice_id"], {"revenue": ZERO, "cost": ZERO})
        r["revenue"] += f["taxable"]
        r["cost"] += f["cost"]
    invoices = {i.pk: i for i in Invoice.objects.filter(pk__in=acc.keys()).select_related("distributor")}
    rows = []
    for iid, v in acc.items():
        inv = invoices[iid]
        rev, cost = q2(v["revenue"]), q2(v["cost"])
        rows.append(
            {
                "invoice_id": iid,
                "invoice_no": inv.invoice_no,
                "date": inv.date,
                "distributor_name": inv.distributor.name,
                "revenue": rev,
                "cost": cost,
                "margin": q2(rev - cost),
                "margin_pct": _pct(rev - cost, rev),
            }
        )
    rows.sort(key=lambda r: (r["date"], r["invoice_no"]), reverse=True)
    months: dict[str, dict] = {}
    for f in facts:
        m = months.setdefault(month_key(f["date"]), {"revenue": ZERO, "cost": ZERO})
        m["revenue"] += f["taxable"]
        m["cost"] += f["cost"]
    trend = [
        {"month": k, "revenue": q2(v["revenue"]), "cost": q2(v["cost"]), "margin": q2(v["revenue"] - v["cost"])}
        for k, v in sorted(months.items())
    ]
    return {"rows": rows, "trend": trend}


def brand_report(frm, to) -> list[dict]:
    facts = sales_facts(frm, to)
    by_brand: dict[int, list[dict]] = defaultdict(list)
    for f in facts:
        by_brand[f["brand_id"]].append(f)
    stock = defaultdict(lambda: {"qty": 0, "value": ZERO})
    for s in product_stock_rows():
        stock[s["brand_id"]]["qty"] += s["available"]
        stock[s["brand_id"]]["value"] += s["value"]
    rows = []
    for b in Brand.objects.order_by("name"):
        f = by_brand.get(b.pk, [])
        revenue = q2(sum((x["taxable"] for x in f), ZERO))
        cost = q2(sum((x["cost"] for x in f), ZERO))
        rows.append(
            {
                "brand_id": b.pk,
                "brand_name": b.name,
                "type": b.type,
                "qty_sold": sum(x["qty"] for x in f),
                "revenue": revenue,
                "cost": cost,
                "margin": q2(revenue - cost),
                "margin_pct": _pct(revenue - cost, revenue),
                "stock_qty": stock[b.pk]["qty"],
                "stock_value": q2(stock[b.pk]["value"]),
            }
        )
    return rows


def product_report(frm, to) -> list[dict]:
    facts = sales_facts(frm, to)
    by_product: dict[int, list[dict]] = defaultdict(list)
    for f in facts:
        by_product[f["product_id"]].append(f)
    stock = {s["product_id"]: s["available"] for s in product_stock_rows()}
    last_sale = {r["product_id"]: r["d"] for r in InvoiceLine.objects.values("product_id").annotate(d=Max("invoice__date"))}
    rows = []
    for p in Product.objects.filter(active=True).select_related("brand"):
        f = by_product.get(p.pk, [])
        revenue = q2(sum((x["taxable"] for x in f), ZERO))
        rows.append(
            {
                "product_id": p.pk,
                "sku": p.sku,
                "name": p.name,
                "brand_name": p.brand.name,
                "qty_sold": sum(x["qty"] for x in f),
                "revenue": revenue,
                "margin": q2(revenue - sum((x["cost"] for x in f), ZERO)),
                "stock_on_hand": stock.get(p.pk, 0),
                "last_sale_date": last_sale.get(p.pk),
                "classification": "average",
            }
        )
    sellers = sorted((r for r in rows if r["qty_sold"] > 0), key=lambda r: -r["revenue"])
    top = max(1, math.ceil(len(sellers) * 0.25))
    bottom_start = math.floor(len(sellers) * 0.6)
    for i, r in enumerate(sellers):
        r["classification"] = "high_selling" if i < top else ("slow_moving" if i >= bottom_start else "average")
    for r in rows:
        if r["qty_sold"] <= 0:
            r["classification"] = "low_performing"
    return sorted(rows, key=lambda r: -r["revenue"])


def distributor_report(frm, to) -> list[dict]:
    balances = {b["distributor_id"]: b["balance"] for b in fin.distributor_balances()}
    inv = {
        r["distributor_id"]: r
        for r in Invoice.objects.filter(date__gte=frm, date__lte=to).values("distributor_id").annotate(n=Count("id"), taxable=Sum("taxable"), total=Sum("total"))
    }
    paid = {r["distributor_id"]: r["t"] for r in Payment.objects.filter(date__gte=frm, date__lte=to).values("distributor_id").annotate(t=Sum("amount"))}
    returns_value: dict[int, Decimal] = defaultdict(lambda: ZERO)
    per_return: dict[int, tuple[int, Decimal]] = {}
    for l in SalesReturnLine.objects.filter(sales_return__date__gte=frm, sales_return__date__lte=to).values(
        "sales_return_id", "sales_return__distributor_id", "qty", "rate", "discount_pct"
    ):
        did, cur = per_return.get(l["sales_return_id"], (l["sales_return__distributor_id"], ZERO))
        per_return[l["sales_return_id"]] = (did, cur + l["qty"] * l["rate"] * (1 - l["discount_pct"] / 100))
    for did, v in per_return.values():
        returns_value[did] += q2(v)  # each return is rounded once, as in its own row
    from apps.distribution.models import DistributorStockReport

    reported = {
        r["distributor_id"]: r["t"]
        for r in DistributorStockReport.objects.filter(period__gte=month_key(frm), period__lte=month_key(to)).values("distributor_id").annotate(t=Sum("reported_sales"))
    }
    rows = []
    for d in Distributor.objects.order_by("name"):
        i = inv.get(d.pk)
        taxable = q2(i["taxable"]) if i else ZERO
        ret = q2(returns_value.get(d.pk, ZERO))
        rows.append(
            {
                "distributor_id": d.pk,
                "distributor_name": d.name,
                "type": d.type,
                "invoices": i["n"] if i else 0,
                "taxable": taxable,
                "invoiced": q2(i["total"]) if i else ZERO,
                "collected": q2(paid.get(d.pk, ZERO)),
                "outstanding": balances.get(d.pk, ZERO),
                "returns_value": ret,
                "return_pct": q2(ret / taxable * 100) if taxable else ZERO,
                "reported_sales": reported.get(d.pk),
            }
        )
    return rows


def purchase_register(frm, to) -> list[dict]:
    company_state = Settings.load().state.strip().lower()
    rows = []
    for g in GoodsReceipt.objects.filter(date__gte=frm, date__lte=to).select_related("supplier").order_by("-date", "-grn_no"):
        inter = g.supplier.state.strip().lower() != company_state
        half = q2(g.tax / 2)
        rows.append(
            {
                "grn_id": g.pk,
                "grn_no": g.grn_no,
                "date": g.date,
                "supplier_name": g.supplier.name,
                "gstin": g.supplier.gstin,
                "supplier_invoice_no": g.supplier_invoice_no,
                "taxable": g.taxable,
                "cgst": ZERO if inter else half,
                "sgst": ZERO if inter else g.tax - half,
                "igst": g.tax if inter else ZERO,
                "total": g.total,
            }
        )
    return rows


def sales_register(frm, to) -> list[dict]:
    return [
        {
            "invoice_id": i.pk,
            "invoice_no": i.invoice_no,
            "date": i.date,
            "distributor_name": i.distributor.name,
            "gstin": i.distributor.gstin,
            "taxable": i.taxable,
            "cgst": i.cgst,
            "sgst": i.sgst,
            "igst": i.igst,
            "round_off": i.round_off,
            "total": i.total,
        }
        for i in Invoice.objects.filter(date__gte=frm, date__lte=to).select_related("distributor").order_by("-date", "-invoice_no")
    ]


def gst_summary(frm, to) -> dict:
    rates: dict[Decimal, dict] = {}
    months: dict[str, dict] = {}
    lines = InvoiceLine.objects.filter(invoice__date__gte=frm, invoice__date__lte=to).values("gst_rate", "taxable", "cgst", "sgst", "igst", "invoice__date")
    for l in lines:
        r = rates.setdefault(l["gst_rate"], {"taxable": ZERO, "cgst": ZERO, "sgst": ZERO, "igst": ZERO})
        for k in r:
            r[k] += l[k]
        m = months.setdefault(month_key(l["invoice__date"]), {"taxable": ZERO, "tax": ZERO})
        m["taxable"] += l["taxable"]
        m["tax"] += l["cgst"] + l["sgst"] + l["igst"]
    inv = Invoice.objects.filter(date__gte=frm, date__lte=to).aggregate(t=Sum("taxable"), c=Sum("cgst"), s=Sum("sgst"), i=Sum("igst"))
    taxable, cgst, sgst, igst = (q2(inv[k] or ZERO) for k in ("t", "c", "s", "i"))

    def note_tax(kind):
        a = NoteDocument.objects.filter(type=kind, date__gte=frm, date__lte=to).aggregate(c=Sum("cgst"), s=Sum("sgst"), i=Sum("igst"))
        return q2((a["c"] or ZERO) + (a["s"] or ZERO) + (a["i"] or ZERO))

    credit, debit = note_tax("credit"), note_tax("debit")
    grn = GoodsReceipt.objects.filter(date__gte=frm, date__lte=to).aggregate(t=Sum("taxable"), x=Sum("tax"))
    ret = SupplierReturn.objects.filter(date__gte=frm, date__lte=to).aggregate(t=Sum("taxable"), x=Sum("tax"))
    tax = cgst + sgst + igst
    return {
        "by_rate": [
            {"rate": rate, "taxable": q2(v["taxable"]), "cgst": q2(v["cgst"]), "sgst": q2(v["sgst"]), "igst": q2(v["igst"]), "tax": q2(v["cgst"] + v["sgst"] + v["igst"])}
            for rate, v in sorted(rates.items())
        ],
        "by_month": [{"month": k, "taxable": q2(v["taxable"]), "tax": q2(v["tax"])} for k, v in sorted(months.items())],
        "output": {
            "taxable": taxable, "cgst": cgst, "sgst": sgst, "igst": igst, "tax": tax,
            "credit_note_tax": credit, "debit_note_tax": debit, "net_tax": q2(tax - credit + debit),
        },
        "input": {"taxable": q2((grn["t"] or ZERO) - (ret["t"] or ZERO)), "tax": q2((grn["x"] or ZERO) - (ret["x"] or ZERO))},
    }


def dashboard() -> dict:
    from apps.distribution.models import DistributionOrder
    from apps.finance.ranges import last_months, start_of_month
    from apps.purchasing.models import SupplierPayment

    today = timezone.localdate()
    this_m, prev_m = month_key(today), month_key(start_of_month(today) - timedelta(days=1))
    months = last_months(6, today)

    def sums(model, field, date_field="date"):
        out: dict[str, Decimal] = defaultdict(lambda: ZERO)
        for r in model.objects.filter(**{f"{date_field}__gte": f"{months[0]}-01"}).values(date_field, field):
            out[month_key(r[date_field])] += r[field]
        return out

    sales_m, purch_m, coll_m = sums(Invoice, "taxable"), sums(GoodsReceipt, "taxable"), sums(Payment, "amount")

    batches = batch_stock_rows()
    products = product_stock_rows(batches)
    expired = [b for b in batches if b["expiry_status"] == "expired" and b["saleable"] + b["expired"] > 0]
    expiring = sorted((b for b in batches if b["expiry_status"] in ("critical", "warning") and b["saleable"] > 0), key=lambda b: b["days_to_expiry"])
    active_ids = set(Product.objects.filter(active=True).values_list("pk", flat=True))
    low = [p for p in products if p["stock_status"] != "ok" and p["product_id"] in active_ids]

    balances = fin.distributor_balances()
    overdue_vals = fin.overdue_invoice_values()
    overdue_sorted = sorted(overdue_vals, key=lambda r: r["id"])
    od_rows = fin.invoice_rows(Invoice.objects.filter(pk__in=[r["id"] for r in overdue_sorted]))
    od_rows.sort(key=lambda r: -r["days_overdue"])

    purchases_total = {r["supplier_id"]: r["t"] for r in GoodsReceipt.objects.values("supplier_id").annotate(t=Sum("total"))}
    returns_total = {r["supplier_id"]: r["t"] for r in SupplierReturn.objects.values("supplier_id").annotate(t=Sum("total"))}
    paid_total = {r["supplier_id"]: r["t"] for r in SupplierPayment.objects.values("supplier_id").annotate(t=Sum("amount"))}
    payables = sum((max(ZERO, purchases_total.get(s, ZERO) - returns_total.get(s, ZERO) - paid_total.get(s, ZERO)) for s in purchases_total), ZERO)

    facts = [f for f in sales_facts(f"{months[0]}-01", today) if month_key(f["date"]) >= months[3]]
    brand_totals: dict[int, Decimal] = defaultdict(lambda: ZERO)
    for f in facts:
        brand_totals[f["brand_id"]] += f["taxable"]
    brand_names = dict(Brand.objects.values_list("pk", "name"))

    since = f"{months[3]}-01"
    sales_by_dist = {r["distributor_id"]: r["t"] for r in Invoice.objects.filter(date__gte=since).values("distributor_id").annotate(t=Sum("taxable"))}
    top = sorted(
        (
            {"name": b["distributor_name"], "sales": q2(sales_by_dist.get(b["distributor_id"], ZERO)), "outstanding": max(ZERO, b["balance"])}
            for b in balances
        ),
        key=lambda r: -r["sales"],
    )[:6]
    recent = fin.invoice_rows(Invoice.objects.order_by("-date", "-invoice_no")[:6])
    recent.sort(key=lambda r: (r["date"], r["invoice_no"]), reverse=True)

    return {
        "kpis": {
            "stock_value": q2(sum((p["value"] for p in products), ZERO)),
            "sales_month": q2(sales_m[this_m]),
            "sales_prev_month": q2(sales_m[prev_m]),
            "purchases_month": q2(purch_m[this_m]),
            "receivables": q2(sum((max(ZERO, b["balance"]) for b in balances), ZERO)),
            "overdue_receivables": q2(sum((r["outstanding"] for r in overdue_vals), ZERO)),
            "payables": q2(payables),
            "collections_month": q2(coll_m[this_m]),
            "expiring_batches": len(expiring),
            "expired_batches": len(expired),
            "low_stock_products": len(low),
            "open_orders": DistributionOrder.objects.filter(status__in=["confirmed", "partially_dispatched"]).count(),
        },
        "monthly": [{"month": m, "sales": q2(sales_m[m]), "purchases": q2(purch_m[m]), "collections": q2(coll_m[m])} for m in months],
        "sales_by_brand": sorted(({"name": brand_names.get(k, str(k)), "value": q2(v)} for k, v in brand_totals.items()), key=lambda r: -r["value"]),
        "top_distributors": top,
        "recent_invoices": recent,
        "expiring_soon": (expired + expiring)[:6],
        "overdue": od_rows[:6],
        "low_stock": low[:6],
    }

