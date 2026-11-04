"""Row factories for finance/report tests. They build documents with plain ORM objects (no other app's services)."""

from datetime import timedelta
from decimal import Decimal
from itertools import count

from apps.core.models import Settings
from apps.core.money import ZERO, q2
from apps.core.tax import document_totals, is_inter_state, line_tax
from apps.core.testing import TODAY, ERPTestCase
from apps.distribution.models import DistributionOrder, Dispatch, DispatchLine, OrderLine
from apps.purchasing.models import GoodsReceipt, PurchaseOrder, SupplierPayment, SupplierReturn
from apps.sales.models import Invoice, InvoiceLine, NoteDocument, SalesReturn, SalesReturnLine

_seq = count(1)


class FinanceTestCase(ERPTestCase):
    def make_invoice(self, distributor=None, qty=10, rate="100", gst="18", date=None, discount="0", product=None, batch=None, unit_cost="60"):
        distributor = distributor or self.dist_local
        product = product or self.product
        date = date or TODAY
        n = next(_seq)
        batch = batch or self.make_batch(product, qty=qty + 1000, batch_no=f"INV-B-{n}")
        rate, gst, discount, unit_cost = Decimal(rate), Decimal(gst), Decimal(discount), Decimal(unit_cost)
        order = DistributionOrder.objects.create(order_no=f"ORD-T-{n}", distributor=distributor, date=date, status="dispatched")
        OrderLine.objects.create(order=order, product=product, qty=qty, rate=rate, discount_pct=discount, gst_rate=gst)
        dispatch = Dispatch.objects.create(dispatch_no=f"DSP-T-{n}", order=order, distributor=distributor, date=date)
        DispatchLine.objects.create(dispatch=dispatch, product=product, batch=batch, qty=qty)
        inter = is_inter_state(Settings.load().state, distributor.state)
        lt = line_tax(qty, rate, discount, gst, inter)
        tot = document_totals([lt])
        inv = Invoice.objects.create(
            invoice_no=f"INV-T-{n:04d}", distributor=distributor, order=order, dispatch=dispatch, date=date,
            due_date=date + timedelta(days=distributor.credit_days), inter_state=inter,
            taxable=tot.taxable, cgst=tot.cgst, sgst=tot.sgst, igst=tot.igst, round_off=tot.round_off, total=tot.total,
        )
        InvoiceLine.objects.create(
            invoice=inv, product=product, batch=batch, qty=qty, rate=rate, discount_pct=discount, gst_rate=gst, unit_cost=unit_cost,
            taxable=lt.taxable, cgst=lt.cgst, sgst=lt.sgst, igst=lt.igst,
        )
        return inv

    def make_note(self, invoice, kind="credit", taxable="100", gst="18", date=None, sales_return=None):
        n = next(_seq)
        lt = line_tax(1, Decimal(taxable), 0, Decimal(gst), invoice.inter_state)
        return NoteDocument.objects.create(
            note_no=f"{'CN' if kind == 'credit' else 'DN'}-T-{n:04d}", type=kind, distributor=invoice.distributor, invoice=invoice,
            sales_return=sales_return, date=date or TODAY, reason="Test", taxable=lt.taxable, cgst=lt.cgst, sgst=lt.sgst, igst=lt.igst, total=lt.total,
        )

    def make_return(self, invoice, qty=2, classification="saleable", date=None):
        n = next(_seq)
        line = invoice.lines.first()
        ret = SalesReturn.objects.create(return_no=f"RET-T-{n:04d}", distributor=invoice.distributor, invoice=invoice, date=date or TODAY, reason="damaged")
        SalesReturnLine.objects.create(
            sales_return=ret, product=line.product, batch=line.batch, qty=qty, rate=line.rate, discount_pct=line.discount_pct,
            gst_rate=line.gst_rate, unit_cost=line.unit_cost, classification=classification,
        )
        return ret

    def make_grn(self, taxable="500", tax="90", date=None, supplier=None):
        n = next(_seq)
        supplier = supplier or self.supplier
        taxable, tax = Decimal(taxable), Decimal(tax)
        po = PurchaseOrder.objects.create(po_no=f"PO-T-{n:04d}", supplier=supplier, date=date or TODAY, status="received")
        return GoodsReceipt.objects.create(
            grn_no=f"GRN-T-{n:04d}", po=po, supplier=supplier, date=date or TODAY, supplier_invoice_no=f"S-{n}",
            taxable=taxable, tax=tax, total=taxable + tax,
        )

    def make_supplier_return(self, taxable="50", tax="9", date=None):
        n = next(_seq)
        return SupplierReturn.objects.create(
            return_no=f"SRT-T-{n:04d}", supplier=self.supplier, date=date or TODAY, taxable=Decimal(taxable), tax=Decimal(tax), total=Decimal(taxable) + Decimal(tax)
        )

    def make_supplier_payment(self, amount="100", date=None):
        n = next(_seq)
        return SupplierPayment.objects.create(payment_no=f"SPY-T-{n:04d}", supplier=self.supplier, date=date or TODAY, amount=Decimal(amount), mode="bank_transfer")

    @staticmethod
    def dec(value) -> Decimal:
        return q2(Decimal(str(value))) if value is not None else ZERO
