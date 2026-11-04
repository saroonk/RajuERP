import { round2 } from './format';

export const GST_RATES = [0, 5, 12, 18, 28] as const;

export interface TaxableLine {
  qty: number;
  rate: number;
  discountPct: number;
  gstRate: number;
}

export interface LineTax {
  gross: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  total: number;
}

/** GST for one line. Intra-state supplies split the tax equally into CGST and SGST; inter-state supplies charge IGST. */
export function computeLineTax(line: TaxableLine, interState: boolean): LineTax {
  const gross = round2(line.qty * line.rate);
  const discount = round2((gross * line.discountPct) / 100);
  const taxable = round2(gross - discount);
  const tax = round2((taxable * line.gstRate) / 100);
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (interState) {
    igst = tax;
  } else {
    cgst = round2(tax / 2);
    sgst = round2(tax - cgst);
  }
  return { gross, discount, taxable, cgst, sgst, igst, tax, total: round2(taxable + tax) };
}

export interface DocumentTotals {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  /** Sum of taxable + tax before rounding off to the nearest rupee. */
  subtotal: number;
  roundOff: number;
  total: number;
}

export function computeDocumentTotals(lines: TaxableLine[], interState: boolean, roundToRupee = true): DocumentTotals {
  let taxable = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  for (const l of lines) {
    const t = computeLineTax(l, interState);
    taxable += t.taxable;
    cgst += t.cgst;
    sgst += t.sgst;
    igst += t.igst;
  }
  taxable = round2(taxable);
  cgst = round2(cgst);
  sgst = round2(sgst);
  igst = round2(igst);
  const tax = round2(cgst + sgst + igst);
  const subtotal = round2(taxable + tax);
  const total = roundToRupee ? Math.round(subtotal) : subtotal;
  return { taxable, cgst, sgst, igst, tax, subtotal, roundOff: round2(total - subtotal), total };
}

/** Taxable value and tax for a purchase-side document (no discount, no rounding off). */
export function computePurchaseTotals(lines: { qty: number; rate: number; gstRate: number }[]) {
  const t = computeDocumentTotals(
    lines.map((l) => ({ ...l, discountPct: 0 })),
    false,
    false,
  );
  return { taxable: t.taxable, tax: t.tax, total: t.subtotal };
}

export const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;

export const INDIAN_STATES = [
  'Andhra Pradesh',
  'Delhi',
  'Goa',
  'Gujarat',
  'Karnataka',
  'Kerala',
  'Maharashtra',
  'Odisha',
  'Tamil Nadu',
  'Telangana',
  'West Bengal',
];
