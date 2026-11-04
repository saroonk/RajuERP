"""GST calculation shared by invoices, credit/debit notes and purchase documents (mirrors the frontend rules)."""

from dataclasses import dataclass
from decimal import Decimal

from .money import ZERO, D, q2, round_rupee


@dataclass(frozen=True)
class LineTax:
    gross: Decimal
    discount: Decimal
    taxable: Decimal
    cgst: Decimal
    sgst: Decimal
    igst: Decimal

    @property
    def tax(self) -> Decimal:
        return self.cgst + self.sgst + self.igst

    @property
    def total(self) -> Decimal:
        return self.taxable + self.tax


def is_inter_state(supplier_state: str, recipient_state: str) -> bool:
    """Place-of-supply rule used here: different states => IGST, same state => CGST + SGST."""
    return (supplier_state or "").strip().lower() != (recipient_state or "").strip().lower()


def line_tax(qty, rate, discount_pct, gst_rate, inter_state: bool) -> LineTax:
    gross = q2(D(qty) * D(rate))
    discount = q2(gross * D(discount_pct) / 100)
    taxable = gross - discount
    tax = q2(taxable * D(gst_rate) / 100)
    if inter_state:
        return LineTax(gross, discount, taxable, ZERO, ZERO, tax)
    cgst = q2(tax / 2)
    return LineTax(gross, discount, taxable, cgst, tax - cgst, ZERO)


@dataclass(frozen=True)
class DocumentTotals:
    taxable: Decimal
    cgst: Decimal
    sgst: Decimal
    igst: Decimal
    round_off: Decimal
    total: Decimal

    @property
    def tax(self) -> Decimal:
        return self.cgst + self.sgst + self.igst


def document_totals(lines: list[LineTax], round_to_rupee: bool = True) -> DocumentTotals:
    taxable = sum((l.taxable for l in lines), ZERO)
    cgst = sum((l.cgst for l in lines), ZERO)
    sgst = sum((l.sgst for l in lines), ZERO)
    igst = sum((l.igst for l in lines), ZERO)
    subtotal = taxable + cgst + sgst + igst
    total = round_rupee(subtotal) if round_to_rupee else subtotal
    return DocumentTotals(taxable, cgst, sgst, igst, total - subtotal, total)


def purchase_totals(lines: list[tuple]) -> tuple[Decimal, Decimal, Decimal]:
    """(taxable, tax, total) for purchase-side lines given as (qty, rate, gst_rate); no discount, no rounding off."""
    parts = [line_tax(q, r, 0, g, False) for q, r, g in lines]
    d = document_totals(parts, round_to_rupee=False)
    return d.taxable, d.tax, d.total
