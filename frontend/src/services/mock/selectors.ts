/** Pure, read-only derivations over the mock db: stock buckets, outstanding balances, view-model rows. */
import type {
  AlertSummary,
  BatchStock,
  DistributionOrder,
  DistributionOrderRow,
  Dispatch,
  DispatchRow,
  DistributorBalance,
  ExpiryStatus,
  GoodsReceipt,
  GoodsReceiptRow,
  ID,
  Invoice,
  InvoiceRow,
  ISODate,
  LedgerEntry,
  NoteDocument,
  NoteRow,
  PaymentRow,
  ProductStock,
  PurchaseOrder,
  PurchaseOrderRow,
  SalesReturn,
  SalesReturnRow,
  StockBucket,
  SupplierPayment,
  SupplierPaymentRow,
  SupplierReturn,
  SupplierReturnRow,
  Payment,
} from '@/types';
import { addDays, daysBetween, round2, today } from '@/utils/format';
import { computePurchaseTotals } from '@/utils/gst';
import { db } from './db';

export const productOf = (id: ID) => db.products.find((p) => p.id === id);
export const brandOf = (id: ID) => db.brands.find((b) => b.id === id);
export const supplierOf = (id: ID) => db.suppliers.find((s) => s.id === id);
export const distributorOf = (id: ID) => db.distributors.find((d) => d.id === id);
export const batchOf = (id: ID) => db.batches.find((b) => b.id === id);
export const productName = (id: ID) => productOf(id)?.name ?? id;

/* ------------------------------ stock ------------------------------ */

export type Buckets = Record<StockBucket, number>;
const emptyBuckets = (): Buckets => ({ saleable: 0, damaged: 0, expired: 0, inspection: 0 });

/** Sums the movement ledger into per-batch bucket quantities. */
export function bucketMap(): Map<ID, Buckets> {
  const map = new Map<ID, Buckets>();
  for (const m of db.movements) {
    let b = map.get(m.batchId);
    if (!b) {
      b = emptyBuckets();
      map.set(m.batchId, b);
    }
    b[m.bucket] += m.qty;
  }
  return map;
}

export function bucketsOf(batchId: ID): Buckets {
  const b = emptyBuckets();
  for (const m of db.movements) if (m.batchId === batchId) b[m.bucket] += m.qty;
  return b;
}

export function expiryStatusOf(expiryDate: ISODate, onDate: ISODate = today()): { days: number; status: ExpiryStatus } {
  const days = daysBetween(onDate, expiryDate);
  let status: ExpiryStatus = 'ok';
  if (days < 0) status = 'expired';
  else if (days <= 30) status = 'critical';
  else if (days <= db.settings.expiryAlertDays) status = 'warning';
  return { days, status };
}

export function batchStockRows(): BatchStock[] {
  const buckets = bucketMap();
  return db.batches.map((b) => {
    const p = productOf(b.productId);
    const q = buckets.get(b.id) ?? emptyBuckets();
    const { days, status } = expiryStatusOf(b.expiryDate);
    return {
      ...b,
      productName: p?.name ?? b.productId,
      sku: p?.sku ?? '',
      brandId: p?.brandId ?? '',
      brandName: brandOf(p?.brandId ?? '')?.name ?? '',
      saleable: q.saleable,
      damaged: q.damaged,
      expired: q.expired,
      inspection: q.inspection,
      onHand: q.saleable + q.damaged + q.expired + q.inspection,
      available: days < 0 ? 0 : q.saleable,
      daysToExpiry: days,
      expiryStatus: status,
    };
  });
}

export function productStockRows(): ProductStock[] {
  const rows = batchStockRows();
  return db.products.map((p) => {
    const mine = rows.filter((r) => r.productId === p.id);
    const available = mine.reduce((s, r) => s + r.available, 0);
    const expired = mine.reduce((s, r) => s + (r.expiryStatus === 'expired' ? r.saleable : 0) + r.expired, 0);
    const damaged = mine.reduce((s, r) => s + r.damaged, 0);
    const inspection = mine.reduce((s, r) => s + r.inspection, 0);
    const value = round2(mine.reduce((s, r) => s + r.available * r.costPrice, 0));
    const category = db.categories.find((c) => c.id === p.categoryId);
    const unit = db.units.find((u) => u.id === p.unitId);
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      brandId: p.brandId,
      brandName: brandOf(p.brandId)?.name ?? '',
      categoryId: p.categoryId,
      categoryName: category?.name ?? '',
      unitCode: unit?.code ?? '',
      packSize: p.packSize,
      minStock: p.minStock,
      available,
      expired,
      damaged,
      inspection,
      batches: mine.filter((r) => r.onHand > 0).length,
      stockStatus: available <= 0 ? 'out' : available < p.minStock ? 'low' : 'ok',
      value,
    };
  });
}

/** Batches that can be dispatched on `date`: saleable quantity left and not expired on that date. */
export function dispatchableOn(productId: ID, date: ISODate, buckets = bucketMap()): { batch: ReturnType<typeof batchOf> & {}; qty: number }[] {
  return db.batches
    .filter((b) => b.productId === productId && b.expiryDate >= date && b.receivedOn <= date)
    .map((b) => ({ batch: b, qty: buckets.get(b.id)?.saleable ?? 0 }))
    .filter((x) => x.qty > 0)
    .sort((a, b) => a.batch.expiryDate.localeCompare(b.batch.expiryDate));
}

/* --------------------------- purchase rows --------------------------- */

export function poRow(po: PurchaseOrder): PurchaseOrderRow {
  const totals = computePurchaseTotals(po.lines);
  const receipts = db.goodsReceipts.filter((g) => g.poId === po.id);
  const lineProgress = po.lines.map((l) => {
    const received = receipts.reduce(
      (s, g) => s + g.lines.filter((gl) => gl.productId === l.productId).reduce((x, gl) => x + gl.qty, 0),
      0,
    );
    return { productId: l.productId, ordered: l.qty, received, pending: Math.max(0, l.qty - received) };
  });
  const ordered = lineProgress.reduce((s, l) => s + l.ordered, 0);
  const received = lineProgress.reduce((s, l) => s + Math.min(l.received, l.ordered), 0);
  return {
    ...po,
    supplierName: supplierOf(po.supplierId)?.name ?? po.supplierId,
    ...totals,
    lineProgress,
    receivedPct: ordered ? Math.round((received / ordered) * 100) : 0,
  };
}

export function grnRow(g: GoodsReceipt): GoodsReceiptRow {
  return {
    ...g,
    supplierName: supplierOf(g.supplierId)?.name ?? g.supplierId,
    poNo: db.purchaseOrders.find((p) => p.id === g.poId)?.poNo ?? '',
  };
}

export const supplierReturnRow = (r: SupplierReturn): SupplierReturnRow => ({
  ...r,
  supplierName: supplierOf(r.supplierId)?.name ?? r.supplierId,
});

export const supplierPaymentRow = (p: SupplierPayment): SupplierPaymentRow => ({
  ...p,
  supplierName: supplierOf(p.supplierId)?.name ?? p.supplierId,
});

/* -------------------------- distribution rows -------------------------- */

export function orderRow(o: DistributionOrder): DistributionOrderRow {
  const dispatches = db.dispatches.filter((d) => d.orderId === o.id);
  const lineProgress = o.lines.map((l) => {
    const dispatched = dispatches.reduce(
      (s, d) => s + d.lines.filter((dl) => dl.productId === l.productId).reduce((x, dl) => x + dl.qty, 0),
      0,
    );
    return { productId: l.productId, ordered: l.qty, dispatched, pending: Math.max(0, l.qty - dispatched) };
  });
  const ordered = lineProgress.reduce((s, l) => s + l.ordered, 0);
  const done = lineProgress.reduce((s, l) => s + Math.min(l.dispatched, l.ordered), 0);
  const d = distributorOf(o.distributorId);
  const interState = !!d && d.state !== db.settings.state;
  const t = orderTotals(o, interState);
  return {
    ...o,
    distributorName: d?.name ?? o.distributorId,
    ...t,
    lineProgress,
    dispatchedPct: ordered ? Math.round((done / ordered) * 100) : 0,
    hasDispatches: dispatches.length > 0,
  };
}

function orderTotals(o: DistributionOrder, interState: boolean) {
  let taxable = 0;
  let tax = 0;
  for (const l of o.lines) {
    const t = round2(l.qty * l.rate * (1 - l.discountPct / 100));
    taxable += t;
    tax += round2((t * l.gstRate) / 100);
  }
  void interState;
  return { taxable: round2(taxable), tax: round2(tax), total: round2(taxable + tax) };
}

export function dispatchRow(d: Dispatch): DispatchRow {
  return {
    ...d,
    orderNo: db.orders.find((o) => o.id === d.orderId)?.orderNo ?? '',
    distributorName: distributorOf(d.distributorId)?.name ?? d.distributorId,
    invoiceNo: d.invoiceId ? (db.invoices.find((i) => i.id === d.invoiceId)?.invoiceNo ?? null) : null,
    totalQty: d.lines.reduce((s, l) => s + l.qty, 0),
  };
}

/* ------------------------------ sales rows ------------------------------ */

function paidByInvoice(): Map<ID, number> {
  const m = new Map<ID, number>();
  for (const p of db.payments) for (const a of p.allocations) m.set(a.invoiceId, (m.get(a.invoiceId) ?? 0) + a.amount);
  return m;
}

function notesByInvoice(type: 'credit' | 'debit'): Map<ID, number> {
  const m = new Map<ID, number>();
  for (const n of db.notes) if (n.type === type && n.invoiceId) m.set(n.invoiceId, (m.get(n.invoiceId) ?? 0) + n.total);
  return m;
}

export function invoiceRows(): InvoiceRow[] {
  const paid = paidByInvoice();
  const credits = notesByInvoice('credit');
  const debits = notesByInvoice('debit');
  const now = today();
  return db.invoices.map((inv) => toInvoiceRow(inv, paid, credits, debits, now));
}

function toInvoiceRow(
  inv: Invoice,
  paid: Map<ID, number>,
  credits: Map<ID, number>,
  debits: Map<ID, number>,
  now: ISODate,
): InvoiceRow {
  const d = distributorOf(inv.distributorId);
  const p = round2(paid.get(inv.id) ?? 0);
  const c = round2(credits.get(inv.id) ?? 0);
  const db_ = round2(debits.get(inv.id) ?? 0);
  const outstanding = Math.max(0, round2(inv.total + db_ - c - p));
  const overdue = outstanding > 0.005 && inv.dueDate < now;
  return {
    ...inv,
    distributorName: d?.name ?? inv.distributorId,
    distributorGstin: d?.gstin ?? '',
    distributorState: d?.state ?? '',
    orderNo: db.orders.find((o) => o.id === inv.orderId)?.orderNo ?? '',
    dispatchNo: db.dispatches.find((x) => x.id === inv.dispatchId)?.dispatchNo ?? '',
    paid: p,
    credited: c,
    debited: db_,
    outstanding,
    payStatus: outstanding <= 0.005 ? 'paid' : p + c > 0 ? 'partial' : 'unpaid',
    overdue,
    daysOverdue: overdue ? daysBetween(inv.dueDate, now) : 0,
  };
}

export function invoiceRowById(id: ID): InvoiceRow | undefined {
  const inv = db.invoices.find((i) => i.id === id);
  return inv ? toInvoiceRow(inv, paidByInvoice(), notesByInvoice('credit'), notesByInvoice('debit'), today()) : undefined;
}

export function noteRow(n: NoteDocument): NoteRow {
  return {
    ...n,
    distributorName: distributorOf(n.distributorId)?.name ?? n.distributorId,
    invoiceNo: n.invoiceId ? (db.invoices.find((i) => i.id === n.invoiceId)?.invoiceNo ?? null) : null,
    returnNo: n.returnId ? (db.salesReturns.find((r) => r.id === n.returnId)?.returnNo ?? null) : null,
  };
}

export function salesReturnRow(r: SalesReturn): SalesReturnRow {
  return {
    ...r,
    distributorName: distributorOf(r.distributorId)?.name ?? r.distributorId,
    invoiceNo: db.invoices.find((i) => i.id === r.invoiceId)?.invoiceNo ?? '',
    totalQty: r.lines.reduce((s, l) => s + l.qty, 0),
    value: round2(r.lines.reduce((s, l) => s + l.qty * l.rate * (1 - l.discountPct / 100), 0)),
    creditNoteNo: r.creditNoteId ? (db.notes.find((n) => n.id === r.creditNoteId)?.noteNo ?? null) : null,
    status: r.lines.some((l) => l.classification === 'inspection') ? 'pending_inspection' : 'reconciled',
  };
}

export function paymentRow(p: Payment): PaymentRow {
  const allocated = round2(p.allocations.reduce((s, a) => s + a.amount, 0));
  return {
    ...p,
    distributorName: distributorOf(p.distributorId)?.name ?? p.distributorId,
    allocated,
    unallocated: round2(p.amount - allocated),
  };
}

/* ---------------------- receivables, ledger, payables ---------------------- */

export function distributorBalances(): DistributorBalance[] {
  const invoices = invoiceRows();
  return db.distributors.map((d) => {
    const mine = invoices.filter((i) => i.distributorId === d.id);
    const invoiced = round2(mine.reduce((s, i) => s + i.total, 0));
    const debitNotes = round2(db.notes.filter((n) => n.distributorId === d.id && n.type === 'debit').reduce((s, n) => s + n.total, 0));
    const creditNotes = round2(db.notes.filter((n) => n.distributorId === d.id && n.type === 'credit').reduce((s, n) => s + n.total, 0));
    const pays = db.payments.filter((p) => p.distributorId === d.id);
    const received = round2(pays.reduce((s, p) => s + p.amount, 0));
    const unallocated = round2(pays.reduce((s, p) => s + paymentRow(p).unallocated, 0));
    const balance = round2(invoiced + debitNotes - creditNotes - received);
    const overdue = mine.filter((i) => i.overdue);
    return {
      distributorId: d.id,
      distributorName: d.name,
      code: d.code,
      type: d.type,
      creditLimit: d.creditLimit,
      invoiced,
      debitNotes,
      creditNotes,
      received,
      balance,
      unallocated,
      overdueAmount: round2(overdue.reduce((s, i) => s + i.outstanding, 0)),
      overdueInvoices: overdue.length,
      creditUsedPct: d.creditLimit ? Math.round((Math.max(0, balance) / d.creditLimit) * 100) : 0,
      overLimit: d.creditLimit > 0 && balance > d.creditLimit,
      lastPaymentDate: pays.length ? pays.map((p) => p.date).sort().at(-1)! : null,
    };
  });
}

export function balanceOf(distributorId: ID): number {
  return distributorBalances().find((b) => b.distributorId === distributorId)?.balance ?? 0;
}

export function ledgerFor(distributorId: ID): LedgerEntry[] {
  type Raw = Omit<LedgerEntry, 'balance'> & { order: number };
  const raw: Raw[] = [];
  for (const i of db.invoices.filter((x) => x.distributorId === distributorId)) {
    raw.push({ date: i.date, type: 'invoice', ref: i.invoiceNo, refId: i.id, description: 'Sales invoice', debit: i.total, credit: 0, order: 0 });
  }
  for (const n of db.notes.filter((x) => x.distributorId === distributorId)) {
    const inv = n.invoiceId ? db.invoices.find((i) => i.id === n.invoiceId)?.invoiceNo : null;
    raw.push({
      date: n.date,
      type: n.type === 'credit' ? 'credit_note' : 'debit_note',
      ref: n.noteNo,
      refId: n.id,
      description: `${n.type === 'credit' ? 'Credit' : 'Debit'} note${inv ? ` against ${inv}` : ''} — ${n.reason}`,
      debit: n.type === 'debit' ? n.total : 0,
      credit: n.type === 'credit' ? n.total : 0,
      order: 1,
    });
  }
  for (const p of db.payments.filter((x) => x.distributorId === distributorId)) {
    raw.push({ date: p.date, type: 'payment', ref: p.receiptNo, refId: p.id, description: `Payment received (${p.mode.replace('_', ' ')})${p.reference ? ` — ${p.reference}` : ''}`, debit: 0, credit: p.amount, order: 2 });
  }
  raw.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.ref.localeCompare(b.ref));
  let balance = 0;
  return raw.map(({ order: _o, ...e }) => {
    balance = round2(balance + e.debit - e.credit);
    return { ...e, balance };
  });
}

export function supplierBalances() {
  return db.suppliers.map((s) => {
    const purchases = round2(db.goodsReceipts.filter((g) => g.supplierId === s.id).reduce((a, g) => a + g.total, 0));
    const returns = round2(db.supplierReturns.filter((r) => r.supplierId === s.id).reduce((a, r) => a + r.total, 0));
    const pays = db.supplierPayments.filter((p) => p.supplierId === s.id);
    const paid = round2(pays.reduce((a, p) => a + p.amount, 0));
    return {
      supplierId: s.id,
      supplierName: s.name,
      gstin: s.gstin,
      purchases,
      returns,
      paid,
      outstanding: round2(purchases - returns - paid),
      lastPaymentDate: pays.length ? pays.map((p) => p.date).sort().at(-1)! : null,
    };
  });
}

/** Open invoices of a distributor, oldest due date first. */
export function openInvoices(distributorId: ID): InvoiceRow[] {
  return invoiceRows()
    .filter((i) => i.distributorId === distributorId && i.outstanding > 0.005)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.date.localeCompare(b.date));
}

/* ------------------------------- alerts ------------------------------- */

export function alerts(): AlertSummary {
  const batches = batchStockRows();
  const expired = batches.filter((b) => b.expiryStatus === 'expired' && b.saleable + b.expired + b.damaged + b.inspection > 0 && b.saleable + b.expired > 0);
  const expiring = batches
    .filter((b) => (b.expiryStatus === 'critical' || b.expiryStatus === 'warning') && b.saleable > 0)
    .sort((a, b) => a.daysToExpiry - b.daysToExpiry);
  const lowStock = productStockRows().filter((p) => p.stockStatus !== 'ok' && db.products.find((x) => x.id === p.productId)?.active);
  const overdue = invoiceRows().filter((i) => i.overdue).sort((a, b) => b.daysOverdue - a.daysOverdue);
  const overLimit = distributorBalances().filter((b) => b.overLimit);
  const pendingInspection = db.salesReturns.reduce((s, r) => s + r.lines.filter((l) => l.classification === 'inspection').length, 0);
  return {
    expiring,
    expired,
    lowStock,
    overdue,
    overLimit,
    pendingInspection,
    total: expiring.length + expired.length + lowStock.length + overdue.length + overLimit.length + pendingInspection,
  };
}

/* ------------------------- sales facts (reports) ------------------------- */

export interface SalesFact {
  date: ISODate;
  invoiceId: ID;
  distributorId: ID;
  productId: ID;
  brandId: ID;
  qty: number;
  taxable: number;
  cost: number;
}

/** One row per invoice line, plus negative rows for returned goods so that reports are net of returns. */
export function salesFacts(): SalesFact[] {
  const facts: SalesFact[] = [];
  for (const inv of db.invoices) {
    for (const l of inv.lines) {
      facts.push({
        date: inv.date,
        invoiceId: inv.id,
        distributorId: inv.distributorId,
        productId: l.productId,
        brandId: productOf(l.productId)?.brandId ?? '',
        qty: l.qty,
        taxable: l.taxable,
        cost: round2(l.qty * l.unitCost),
      });
    }
  }
  for (const r of db.salesReturns) {
    for (const l of r.lines) {
      facts.push({
        date: r.date,
        invoiceId: r.invoiceId,
        distributorId: r.distributorId,
        productId: l.productId,
        brandId: productOf(l.productId)?.brandId ?? '',
        qty: -l.qty,
        taxable: -round2(l.qty * l.rate * (1 - l.discountPct / 100)),
        // Goods that go back into saleable stock reverse their cost; damaged/expired goods stay a cost.
        cost: l.classification === 'saleable' ? -round2(l.qty * l.unitCost) : 0,
      });
    }
  }
  return facts;
}

export { addDays };
