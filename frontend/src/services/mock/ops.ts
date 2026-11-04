/**
 * Synchronous business operations on the mock db. Every stock change goes through `postMovement`,
 * so batch quantities, valuation and alerts all derive from one ledger. The async services in
 * ./services.ts wrap these (adding latency and change notification); the seed calls them directly.
 */
import type {
  Batch,
  DistributionOrder,
  Dispatch,
  GoodsReceipt,
  ID,
  Invoice,
  InvoiceLine,
  InvoiceRow,
  ISODate,
  MovementType,
  NoteDocument,
  Payment,
  PurchaseOrder,
  Reconciliation,
  SalesReturn,
  StockBucket,
  SupplierPayment,
  SupplierReturn,
  WriteOff,
} from '@/types';
import { addDays, formatNumber, round2, today } from '@/utils/format';
import { computeDocumentTotals, computeLineTax, computePurchaseTotals } from '@/utils/gst';
import type {
  DispatchInput,
  GRNInput,
  NoteInput,
  OrderInput,
  PaymentInput,
  POInput,
  ReconciliationInput,
  SalesReturnInput,
  SupplierPaymentInput,
  SupplierReturnInput,
  WriteOffInput,
} from '../types';
import { actorName, audit, db, fail, must, nextDocNo, nextId } from './db';
import {
  batchOf,
  bucketsOf,
  bucketMap,
  dispatchableOn,
  distributorOf,
  invoiceRowById,
  orderRow,
  poRow,
  productOf,
  supplierOf,
} from './selectors';

function postMovement(m: {
  date: ISODate;
  batchId: ID;
  type: MovementType;
  bucket: StockBucket;
  qty: number;
  refType: string;
  refId: ID;
  refNo: string;
  note?: string;
}): void {
  const batch = must(batchOf(m.batchId), 'Batch');
  db.movements.push({
    id: nextId('mov'),
    productId: batch.productId,
    createdBy: actorName(),
    note: '',
    ...m,
  });
}

const positive = (n: number, what: string) => {
  if (!Number.isFinite(n) || n <= 0) fail(`${what} must be greater than zero`);
};

/* ------------------------------ purchasing ------------------------------ */

function validatePOLines(lines: POInput['lines']) {
  if (lines.length === 0) fail('Add at least one product line');
  const seen = new Set<ID>();
  for (const l of lines) {
    must(productOf(l.productId), 'Product');
    if (seen.has(l.productId)) fail(`${productOf(l.productId)!.name} appears twice; combine the quantities`);
    seen.add(l.productId);
    positive(l.qty, 'Quantity');
    positive(l.rate, 'Rate');
  }
}

export function createPO(input: POInput): PurchaseOrder {
  must(supplierOf(input.supplierId), 'Supplier');
  validatePOLines(input.lines);
  const po: PurchaseOrder = {
    id: nextId('po'),
    poNo: nextDocNo('po', input.date),
    supplierId: input.supplierId,
    date: input.date,
    expectedDate: input.expectedDate,
    status: input.status,
    lines: input.lines,
    notes: input.notes,
  };
  db.purchaseOrders.push(po);
  audit('create', 'Purchase order', po.poNo, `Created purchase order ${po.poNo}`, input.date);
  return po;
}

export function updatePO(id: ID, input: POInput): PurchaseOrder {
  const po = must(db.purchaseOrders.find((p) => p.id === id), 'Purchase order');
  if (po.status !== 'draft' && po.status !== 'ordered') fail('Only draft or open purchase orders can be edited');
  if (db.goodsReceipts.some((g) => g.poId === id)) fail('This purchase order already has goods received and can no longer be edited');
  validatePOLines(input.lines);
  Object.assign(po, { ...input });
  audit('update', 'Purchase order', po.poNo, `Updated purchase order ${po.poNo}`);
  return po;
}

export function setPOStatus(id: ID, status: 'ordered' | 'cancelled'): PurchaseOrder {
  const po = must(db.purchaseOrders.find((p) => p.id === id), 'Purchase order');
  if (status === 'ordered' && po.status !== 'draft') fail('Only draft orders can be marked as ordered');
  if (status === 'cancelled' && !['draft', 'ordered'].includes(po.status)) fail('Only orders with nothing received can be cancelled');
  po.status = status;
  audit('status', 'Purchase order', po.poNo, `Purchase order ${po.poNo} marked ${status}`);
  return po;
}

export function deletePO(id: ID): void {
  const po = must(db.purchaseOrders.find((p) => p.id === id), 'Purchase order');
  if (db.goodsReceipts.some((g) => g.poId === id)) fail('Cannot delete a purchase order that has goods receipts');
  if (po.status !== 'draft' && po.status !== 'cancelled') fail('Only draft or cancelled purchase orders can be deleted');
  db.purchaseOrders = db.purchaseOrders.filter((p) => p.id !== id);
  audit('delete', 'Purchase order', po.poNo, `Deleted purchase order ${po.poNo}`);
}

export function receiveGoods(input: GRNInput): GoodsReceipt {
  const po = must(db.purchaseOrders.find((p) => p.id === input.poId), 'Purchase order');
  if (po.status !== 'ordered' && po.status !== 'partial') fail('Goods can only be received against an open purchase order');
  if (input.lines.length === 0) fail('Enter at least one received line');
  const progress = new Map(poRow(po).lineProgress.map((l) => [l.productId, l.pending]));
  const grnId = nextId('grn');
  const lines: GoodsReceipt['lines'] = [];
  const created: Batch[] = [];
  const receivedNow = new Map<ID, number>();

  for (const l of input.lines) {
    const poLine = po.lines.find((x) => x.productId === l.productId);
    if (!poLine) fail('Received product is not on the purchase order');
    positive(l.qty, 'Received quantity');
    const name = productOf(l.productId)?.name ?? l.productId;
    if (!l.batchNo.trim()) fail(`Enter a batch number for ${name}`);
    if (!l.mfgDate || !l.expiryDate) fail(`Enter manufacturing and expiry dates for ${name}`);
    if (l.expiryDate <= l.mfgDate) fail(`Expiry date must be after the manufacturing date for ${name}`);
    if (l.expiryDate <= input.date) fail(`${name} batch ${l.batchNo} is already expired and cannot be received`);
    const soFar = (receivedNow.get(l.productId) ?? 0) + l.qty;
    receivedNow.set(l.productId, soFar);
    if (soFar > (progress.get(l.productId) ?? 0)) fail(`Received quantity for ${name} exceeds the pending quantity (${formatNumber(progress.get(l.productId) ?? 0)})`);

    let batch = [...db.batches, ...created].find((b) => b.productId === l.productId && b.batchNo === l.batchNo.trim());
    if (batch && batch.expiryDate !== l.expiryDate) fail(`Batch ${l.batchNo} of ${name} already exists with a different expiry date`);
    if (!batch) {
      batch = {
        id: nextId('bat'),
        productId: l.productId,
        batchNo: l.batchNo.trim(),
        mfgDate: l.mfgDate,
        expiryDate: l.expiryDate,
        receivedQty: 0,
        costPrice: poLine.rate,
        supplierId: po.supplierId,
        receiptId: grnId,
        receivedOn: input.date,
      };
      created.push(batch);
    }
    batch.receivedQty += l.qty;
    lines.push({ productId: l.productId, batchId: batch.id, batchNo: batch.batchNo, mfgDate: l.mfgDate, expiryDate: l.expiryDate, qty: l.qty, rate: poLine.rate, gstRate: poLine.gstRate });
  }

  db.batches.push(...created);
  const totals = computePurchaseTotals(lines);
  const grn: GoodsReceipt = {
    id: grnId,
    grnNo: nextDocNo('grn', input.date),
    poId: po.id,
    supplierId: po.supplierId,
    date: input.date,
    supplierInvoiceNo: input.supplierInvoiceNo,
    lines,
    ...totals,
  };
  db.goodsReceipts.push(grn);
  for (const l of lines) {
    postMovement({ date: input.date, batchId: l.batchId, type: 'receipt', bucket: 'saleable', qty: l.qty, refType: 'Goods receipt', refId: grn.id, refNo: grn.grnNo });
  }
  const row = poRow(po);
  po.status = row.lineProgress.every((l) => l.pending === 0) ? 'received' : 'partial';
  audit('create', 'Goods receipt', grn.grnNo, `Received goods against ${po.poNo} (${lines.length} lines)`, input.date);
  return grn;
}

export function createSupplierReturn(input: SupplierReturnInput): SupplierReturn {
  must(supplierOf(input.supplierId), 'Supplier');
  if (input.lines.length === 0) fail('Add at least one batch to return');
  const used = new Map<string, number>();
  const lines: SupplierReturn['lines'] = input.lines.map((l) => {
    const batch = must(batchOf(l.batchId), 'Batch');
    if (batch.supplierId !== input.supplierId) fail(`Batch ${batch.batchNo} was not supplied by this supplier`);
    positive(l.qty, 'Return quantity');
    const key = `${l.batchId}:${l.bucket}`;
    const total = (used.get(key) ?? 0) + l.qty;
    used.set(key, total);
    if (total > bucketsOf(l.batchId)[l.bucket]) fail(`Return quantity for batch ${batch.batchNo} exceeds the ${l.bucket} stock on hand`);
    return { batchId: l.batchId, productId: batch.productId, bucket: l.bucket, qty: l.qty, rate: batch.costPrice, gstRate: productOf(batch.productId)?.gstRate ?? 0 };
  });
  const ret: SupplierReturn = {
    id: nextId('srt'),
    returnNo: nextDocNo('supplierReturn', input.date),
    supplierId: input.supplierId,
    date: input.date,
    reason: input.reason,
    lines,
    ...computePurchaseTotals(lines),
  };
  db.supplierReturns.push(ret);
  for (const l of lines) postMovement({ date: input.date, batchId: l.batchId, type: 'supplier_return', bucket: l.bucket, qty: -l.qty, refType: 'Supplier return', refId: ret.id, refNo: ret.returnNo });
  audit('create', 'Supplier return', ret.returnNo, `Returned goods to supplier (${lines.length} lines)`, input.date);
  return ret;
}

export function createSupplierPayment(input: SupplierPaymentInput): SupplierPayment {
  must(supplierOf(input.supplierId), 'Supplier');
  positive(input.amount, 'Amount');
  const p: SupplierPayment = { id: nextId('spy'), paymentNo: nextDocNo('supplierPayment', input.date), ...input, amount: round2(input.amount) };
  db.supplierPayments.push(p);
  audit('create', 'Supplier payment', p.paymentNo, `Recorded payment to ${supplierOf(p.supplierId)?.name}`, input.date);
  return p;
}

/* ----------------------------- distribution ----------------------------- */

function validateOrderLines(lines: OrderInput['lines']) {
  if (lines.length === 0) fail('Add at least one product line');
  const seen = new Set<ID>();
  for (const l of lines) {
    const p = must(productOf(l.productId), 'Product');
    if (seen.has(l.productId)) fail(`${p.name} appears twice; combine the quantities`);
    seen.add(l.productId);
    positive(l.qty, 'Quantity');
    positive(l.rate, 'Rate');
    if (l.discountPct < 0 || l.discountPct > 100) fail('Discount must be between 0 and 100%');
  }
}

export function createOrder(input: OrderInput): DistributionOrder {
  const d = must(distributorOf(input.distributorId), 'Distributor');
  if (!d.active) fail(`${d.name} is inactive`);
  validateOrderLines(input.lines);
  const o: DistributionOrder = { id: nextId('ord'), orderNo: nextDocNo('order', input.date), ...input };
  db.orders.push(o);
  audit('create', 'Distribution order', o.orderNo, `Created order ${o.orderNo} for ${d.name}`, input.date);
  return o;
}

export function updateOrder(id: ID, input: OrderInput): DistributionOrder {
  const o = must(db.orders.find((x) => x.id === id), 'Order');
  if (db.dispatches.some((d) => d.orderId === id)) fail('This order already has dispatches and can no longer be edited');
  if (o.status !== 'draft' && o.status !== 'confirmed') fail('Only draft or confirmed orders can be edited');
  validateOrderLines(input.lines);
  Object.assign(o, input);
  audit('update', 'Distribution order', o.orderNo, `Updated order ${o.orderNo}`);
  return o;
}

export function setOrderStatus(id: ID, status: 'confirmed' | 'cancelled'): DistributionOrder {
  const o = must(db.orders.find((x) => x.id === id), 'Order');
  if (status === 'confirmed' && o.status !== 'draft') fail('Only draft orders can be confirmed');
  if (status === 'cancelled' && !['draft', 'confirmed'].includes(o.status)) fail('Orders with dispatches cannot be cancelled');
  o.status = status;
  audit('status', 'Distribution order', o.orderNo, `Order ${o.orderNo} ${status}`);
  return o;
}

export function deleteOrder(id: ID): void {
  const o = must(db.orders.find((x) => x.id === id), 'Order');
  if (db.dispatches.some((d) => d.orderId === id)) fail('Cannot delete an order that has dispatches');
  if (o.status !== 'draft' && o.status !== 'cancelled') fail('Only draft or cancelled orders can be deleted');
  db.orders = db.orders.filter((x) => x.id !== id);
  audit('delete', 'Distribution order', o.orderNo, `Deleted order ${o.orderNo}`);
}

/** Earliest-expiry-first suggestion; `exclude` holds quantities already allocated elsewhere in the same form. */
export function suggestAllocation(productId: ID, qty: number, date: ISODate, exclude: Record<ID, number> = {}) {
  let need = qty;
  const out: { batchId: ID; batchNo: string; expiryDate: ISODate; qty: number }[] = [];
  for (const { batch, qty: avail } of dispatchableOn(productId, date)) {
    if (need <= 0) break;
    const free = avail - (exclude[batch.id] ?? 0);
    if (free <= 0) continue;
    const take = Math.min(free, need);
    out.push({ batchId: batch.id, batchNo: batch.batchNo, expiryDate: batch.expiryDate, qty: take });
    need -= take;
  }
  return out;
}

export function createDispatch(input: DispatchInput): Dispatch {
  const order = must(db.orders.find((o) => o.id === input.orderId), 'Order');
  if (order.status !== 'confirmed' && order.status !== 'partially_dispatched') fail('Only confirmed orders can be dispatched');
  if (input.lines.length === 0) fail('Allocate at least one batch');
  const progress = new Map(orderRow(order).lineProgress.map((l) => [l.productId, l.pending]));
  const perProduct = new Map<ID, number>();
  const perBatch = new Map<ID, number>();
  const buckets = bucketMap();

  for (const l of input.lines) {
    positive(l.qty, 'Dispatch quantity');
    const batch = must(batchOf(l.batchId), 'Batch');
    if (batch.productId !== l.productId) fail('Batch does not belong to the selected product');
    const name = productOf(l.productId)?.name ?? l.productId;
    if (!progress.has(l.productId)) fail(`${name} is not on this order`);
    if (batch.expiryDate < input.date) fail(`Batch ${batch.batchNo} of ${name} is expired on the dispatch date`);
    const p = (perProduct.get(l.productId) ?? 0) + l.qty;
    perProduct.set(l.productId, p);
    if (p > (progress.get(l.productId) ?? 0)) fail(`Dispatch quantity for ${name} exceeds the pending order quantity (${formatNumber(progress.get(l.productId) ?? 0)})`);
    const b = (perBatch.get(l.batchId) ?? 0) + l.qty;
    perBatch.set(l.batchId, b);
    if (b > (buckets.get(l.batchId)?.saleable ?? 0)) fail(`Batch ${batch.batchNo} of ${name} has only ${formatNumber(buckets.get(l.batchId)?.saleable ?? 0)} saleable units`);
  }

  const dispatch: Dispatch = {
    id: nextId('dsp'),
    dispatchNo: nextDocNo('dispatch', input.date),
    orderId: order.id,
    distributorId: order.distributorId,
    date: input.date,
    vehicleNo: input.vehicleNo,
    deliveryRef: input.deliveryRef,
    lines: input.lines,
    invoiceId: null,
    notes: input.notes,
  };
  db.dispatches.push(dispatch);
  for (const l of input.lines) {
    postMovement({ date: input.date, batchId: l.batchId, type: 'dispatch', bucket: 'saleable', qty: -l.qty, refType: 'Dispatch', refId: dispatch.id, refNo: dispatch.dispatchNo });
  }
  order.status = orderRow(order).lineProgress.every((l) => l.pending === 0) ? 'dispatched' : 'partially_dispatched';
  audit('create', 'Dispatch', dispatch.dispatchNo, `Dispatched ${input.lines.length} batch lines for ${order.orderNo}`, input.date);
  return dispatch;
}

/* ------------------------------ invoicing ------------------------------ */

export function createInvoiceFromDispatch(dispatchId: ID, date: ISODate): Invoice {
  const dispatch = must(db.dispatches.find((d) => d.id === dispatchId), 'Dispatch');
  if (dispatch.invoiceId) fail('This dispatch has already been invoiced');
  if (date < dispatch.date) fail('Invoice date cannot be before the dispatch date');
  const order = must(db.orders.find((o) => o.id === dispatch.orderId), 'Order');
  const dist = must(distributorOf(dispatch.distributorId), 'Distributor');
  const interState = dist.state !== db.settings.state;

  const lines: InvoiceLine[] = dispatch.lines.map((dl) => {
    const ol = must(order.lines.find((l) => l.productId === dl.productId), 'Order line');
    const batch = must(batchOf(dl.batchId), 'Batch');
    const t = computeLineTax({ qty: dl.qty, rate: ol.rate, discountPct: ol.discountPct, gstRate: ol.gstRate }, interState);
    return {
      productId: dl.productId,
      batchId: dl.batchId,
      qty: dl.qty,
      rate: ol.rate,
      discountPct: ol.discountPct,
      gstRate: ol.gstRate,
      unitCost: batch.costPrice,
      taxable: t.taxable,
      cgst: t.cgst,
      sgst: t.sgst,
      igst: t.igst,
    };
  });
  const totals = computeDocumentTotals(
    lines.map((l) => ({ qty: l.qty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate })),
    interState,
  );
  const inv: Invoice = {
    id: nextId('inv'),
    invoiceNo: nextDocNo('invoice', date),
    distributorId: dist.id,
    orderId: order.id,
    dispatchId: dispatch.id,
    date,
    dueDate: addDays(date, dist.creditDays),
    interState,
    lines,
    taxable: totals.taxable,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    roundOff: totals.roundOff,
    total: totals.total,
  };
  db.invoices.push(inv);
  dispatch.invoiceId = inv.id;
  audit('create', 'Invoice', inv.invoiceNo, `Generated invoice for ${dist.name}`, date);
  return inv;
}

export function createNote(input: NoteInput, extra?: { returnId?: ID; taxable?: number; cgst?: number; sgst?: number; igst?: number; roundOff?: number }): NoteDocument {
  const dist = must(distributorOf(input.distributorId), 'Distributor');
  positive(input.taxable, 'Amount');
  let invoice: Invoice | undefined;
  if (input.invoiceId) {
    invoice = must(db.invoices.find((i) => i.id === input.invoiceId), 'Invoice');
    if (invoice.distributorId !== input.distributorId) fail('Invoice belongs to a different distributor');
  }
  const interState = invoice ? invoice.interState : dist.state !== db.settings.state;
  const t = computeLineTax({ qty: 1, rate: input.taxable, discountPct: 0, gstRate: input.gstRate }, interState);
  const cgst = extra?.cgst ?? t.cgst;
  const sgst = extra?.sgst ?? t.sgst;
  const igst = extra?.igst ?? t.igst;
  const taxable = extra?.taxable ?? t.taxable;
  const note: NoteDocument = {
    id: nextId('note'),
    noteNo: nextDocNo(input.type === 'credit' ? 'creditNote' : 'debitNote', input.date),
    type: input.type,
    distributorId: input.distributorId,
    invoiceId: input.invoiceId,
    returnId: extra?.returnId ?? null,
    date: input.date,
    reason: input.reason,
    taxable,
    cgst,
    sgst,
    igst,
    roundOff: extra?.roundOff ?? 0,
    total: round2(taxable + cgst + sgst + igst + (extra?.roundOff ?? 0)),
  };
  db.notes.push(note);
  audit('create', input.type === 'credit' ? 'Credit note' : 'Debit note', note.noteNo, `${input.type === 'credit' ? 'Credit' : 'Debit'} note for ${dist.name}`, input.date);
  return note;
}

/* -------------------------------- returns -------------------------------- */

export function returnableLines(invoiceId: ID) {
  const inv = must(db.invoices.find((i) => i.id === invoiceId), 'Invoice');
  return inv.lines.map((l) => {
    const returned = db.salesReturns
      .filter((r) => r.invoiceId === invoiceId)
      .reduce((s, r) => s + r.lines.filter((x) => x.productId === l.productId && x.batchId === l.batchId).reduce((a, x) => a + x.qty, 0), 0);
    return {
      productId: l.productId,
      batchId: l.batchId,
      batchNo: batchOf(l.batchId)?.batchNo ?? '',
      invoiced: l.qty,
      returned,
      remaining: l.qty - returned,
    };
  });
}

export function createSalesReturn(input: SalesReturnInput): SalesReturn {
  const inv = must(db.invoices.find((i) => i.id === input.invoiceId), 'Invoice');
  if (input.date < inv.date) fail('Return date cannot be before the invoice date');
  if (input.lines.length === 0) fail('Select at least one line to return');
  const avail = returnableLines(inv.id);
  const taken = new Map<string, number>();
  const lines: SalesReturn['lines'] = input.lines.map((l) => {
    const invLine = inv.lines.find((x) => x.productId === l.productId && x.batchId === l.batchId);
    if (!invLine) fail('Returned item is not on the invoice');
    positive(l.qty, 'Return quantity');
    const key = `${l.productId}:${l.batchId}`;
    const total = (taken.get(key) ?? 0) + l.qty;
    taken.set(key, total);
    const remaining = avail.find((a) => a.productId === l.productId && a.batchId === l.batchId)?.remaining ?? 0;
    if (total > remaining) fail(`Return quantity for ${productOf(l.productId)?.name} exceeds the quantity still returnable (${formatNumber(remaining)})`);
    return {
      productId: l.productId,
      batchId: l.batchId,
      qty: l.qty,
      rate: invLine.rate,
      discountPct: invLine.discountPct,
      gstRate: invLine.gstRate,
      unitCost: invLine.unitCost,
      classification: l.classification,
      dispositionNote: l.classification === 'inspection' ? 'Awaiting inspection' : '',
    };
  });
  const ret: SalesReturn = {
    id: nextId('ret'),
    returnNo: nextDocNo('salesReturn', input.date),
    distributorId: inv.distributorId,
    invoiceId: inv.id,
    date: input.date,
    reason: input.reason,
    notes: input.notes,
    lines,
    creditNoteId: null,
  };
  db.salesReturns.push(ret);
  // Each classification maps to its own stock bucket, so only `saleable` goods re-enter sellable inventory.
  for (const l of lines) {
    postMovement({ date: input.date, batchId: l.batchId, type: 'sales_return', bucket: l.classification, qty: l.qty, refType: 'Sales return', refId: ret.id, refNo: ret.returnNo });
  }
  if (input.issueCreditNote) {
    let taxable = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    for (const l of lines) {
      const t = computeLineTax({ qty: l.qty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate }, inv.interState);
      taxable += t.taxable;
      cgst += t.cgst;
      sgst += t.sgst;
      igst += t.igst;
    }
    // The invoice total was rounded to the rupee but goods are credited at exact value: when this return completes the
    // invoice, carry its round-off so credits equal the invoice total (mirrors the backend rule).
    const exact = round2(round2(taxable) + round2(cgst) + round2(sgst) + round2(igst));
    let roundOff = 0;
    if (avail.every((a) => a.remaining - (taken.get(`${a.productId}:${a.batchId}`) ?? 0) === 0)) {
      const earlier = db.notes.filter((n) => n.invoiceId === inv.id && n.type === 'credit' && n.returnId).reduce((s, n) => s + n.total, 0);
      const gap = round2(inv.total - earlier - exact);
      if (Math.abs(gap) < 1) roundOff = gap;
    }
    const note = createNote(
      { type: 'credit', distributorId: inv.distributorId, invoiceId: inv.id, date: input.date, reason: `Sales return ${ret.returnNo}`, taxable: round2(taxable), gstRate: 0 },
      { returnId: ret.id, taxable: round2(taxable), cgst: round2(cgst), sgst: round2(sgst), igst: round2(igst), roundOff },
    );
    ret.creditNoteId = note.id;
  }
  audit('create', 'Sales return', ret.returnNo, `Recorded return against ${inv.invoiceNo}`, input.date);
  return ret;
}

export function reclassifyReturnLine(returnId: ID, lineIndex: number, to: Exclude<StockBucket, 'inspection'>, note: string, date: ISODate = today()): SalesReturn {
  const ret = must(db.salesReturns.find((r) => r.id === returnId), 'Sales return');
  const line = ret.lines[lineIndex];
  if (!line) fail('Return line not found');
  if (line.classification !== 'inspection') fail('Only lines awaiting inspection can be reclassified');
  postMovement({ date, batchId: line.batchId, type: 'reclassification', bucket: 'inspection', qty: -line.qty, refType: 'Sales return', refId: ret.id, refNo: ret.returnNo, note: `Inspection decision: ${to}` });
  postMovement({ date, batchId: line.batchId, type: 'reclassification', bucket: to, qty: line.qty, refType: 'Sales return', refId: ret.id, refNo: ret.returnNo, note: `Inspection decision: ${to}` });
  line.classification = to;
  line.dispositionNote = note || `Inspected: ${to}`;
  audit('update', 'Sales return', ret.returnNo, `Returned stock marked ${to} after inspection`);
  return ret;
}

/* -------------------------------- payments -------------------------------- */

function checkAllocations(distributorId: ID, allocations: { invoiceId: ID; amount: number }[], available: number, existing: Payment['allocations'] = []) {
  let sum = 0;
  const seen = new Set<ID>();
  for (const a of allocations) {
    positive(a.amount, 'Allocated amount');
    if (seen.has(a.invoiceId)) fail('An invoice appears twice in the allocation');
    seen.add(a.invoiceId);
    const inv = invoiceRowById(a.invoiceId);
    if (!inv || inv.distributorId !== distributorId) fail('Allocated invoice does not belong to this distributor');
    if (a.amount > inv.outstanding + 0.005) fail(`Allocation to ${inv.invoiceNo} exceeds its outstanding amount (${formatNumber(inv.outstanding)})`);
    sum += a.amount;
  }
  void existing;
  if (sum > available + 0.005) fail('Allocated total exceeds the payment amount available');
}

export function createPayment(input: PaymentInput): Payment {
  must(distributorOf(input.distributorId), 'Distributor');
  positive(input.amount, 'Amount');
  const amount = round2(input.amount);
  checkAllocations(input.distributorId, input.allocations, amount);
  const p: Payment = {
    id: nextId('pay'),
    receiptNo: nextDocNo('receipt', input.date),
    distributorId: input.distributorId,
    date: input.date,
    amount,
    mode: input.mode,
    reference: input.reference,
    notes: input.notes,
    allocations: input.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: round2(a.amount) })),
  };
  db.payments.push(p);
  audit('create', 'Payment', p.receiptNo, `Recorded payment from ${distributorOf(p.distributorId)?.name}`, input.date);
  return p;
}

export function allocatePayment(id: ID, allocations: { invoiceId: ID; amount: number }[]): Payment {
  const p = must(db.payments.find((x) => x.id === id), 'Payment');
  const unallocated = round2(p.amount - p.allocations.reduce((s, a) => s + a.amount, 0));
  checkAllocations(p.distributorId, allocations, unallocated);
  for (const a of allocations) {
    const existing = p.allocations.find((x) => x.invoiceId === a.invoiceId);
    if (existing) existing.amount = round2(existing.amount + a.amount);
    else p.allocations.push({ invoiceId: a.invoiceId, amount: round2(a.amount) });
  }
  audit('update', 'Payment', p.receiptNo, 'Allocated payment to invoices');
  return p;
}

/** Oldest-due-first allocation of `amount` over the distributor's open invoices. */
export function suggestAllocations(amount: number, open: InvoiceRow[]) {
  let left = round2(amount);
  return open.map((i) => {
    const take = Math.min(left, i.outstanding);
    left = round2(left - take);
    return { invoiceId: i.id, invoiceNo: i.invoiceNo, date: i.date, dueDate: i.dueDate, outstanding: i.outstanding, suggested: take > 0 ? take : 0 };
  });
}

/* ----------------------- write-offs and reconciliation ----------------------- */

export function createWriteOff(input: WriteOffInput): WriteOff {
  if (input.lines.length === 0) fail('Select at least one batch to write off');
  if (!input.reason.trim()) fail('Enter a reason for the write-off');
  const used = new Map<string, number>();
  const lines = input.lines.map((l) => {
    const batch = must(batchOf(l.batchId), 'Batch');
    positive(l.qty, 'Write-off quantity');
    const key = `${l.batchId}:${l.bucket}`;
    const total = (used.get(key) ?? 0) + l.qty;
    used.set(key, total);
    if (total > bucketsOf(l.batchId)[l.bucket]) fail(`Write-off for batch ${batch.batchNo} exceeds the ${l.bucket} stock on hand`);
    return { batchId: l.batchId, productId: batch.productId, bucket: l.bucket, qty: l.qty, unitCost: batch.costPrice };
  });
  const wo: WriteOff = {
    id: nextId('wo'),
    writeOffNo: nextDocNo('writeOff', input.date),
    date: input.date,
    reason: input.reason,
    lines,
    totalValue: round2(lines.reduce((s, l) => s + l.qty * l.unitCost, 0)),
  };
  db.writeOffs.push(wo);
  for (const l of lines) postMovement({ date: input.date, batchId: l.batchId, type: 'write_off', bucket: l.bucket, qty: -l.qty, refType: 'Write-off', refId: wo.id, refNo: wo.writeOffNo, note: input.reason });
  audit('create', 'Write-off', wo.writeOffNo, `Wrote off stock worth ₹${formatNumber(wo.totalValue)}`, input.date);
  return wo;
}

export function createReconciliation(input: ReconciliationInput): Reconciliation {
  if (input.lines.length === 0) fail('Count at least one batch');
  const buckets = bucketMap();
  const seen = new Set<ID>();
  const rec: Reconciliation = {
    id: nextId('rec'),
    refNo: nextDocNo('reconciliation', input.date),
    date: input.date,
    status: 'draft',
    notes: input.notes,
    approvedBy: null,
    approvedOn: null,
    lines: input.lines.map((l) => {
      const batch = must(batchOf(l.batchId), 'Batch');
      if (seen.has(l.batchId)) fail(`Batch ${batch.batchNo} is counted twice`);
      seen.add(l.batchId);
      if (!Number.isFinite(l.physicalQty) || l.physicalQty < 0) fail('Physical count cannot be negative');
      return { batchId: l.batchId, productId: batch.productId, systemQty: buckets.get(l.batchId)?.saleable ?? 0, physicalQty: l.physicalQty, appliedDiff: null };
    }),
  };
  db.reconciliations.push(rec);
  audit('create', 'Stock reconciliation', rec.refNo, `Recorded physical count for ${rec.lines.length} batches`, input.date);
  return rec;
}

export function approveReconciliation(id: ID): Reconciliation {
  const rec = must(db.reconciliations.find((r) => r.id === id), 'Reconciliation');
  if (rec.status !== 'draft') fail('This reconciliation is already approved');
  const date = today() > rec.date ? today() : rec.date;
  for (const l of rec.lines) {
    const current = bucketsOf(l.batchId).saleable;
    const diff = l.physicalQty - current;
    l.appliedDiff = diff;
    if (diff !== 0) postMovement({ date, batchId: l.batchId, type: 'adjustment', bucket: 'saleable', qty: diff, refType: 'Stock reconciliation', refId: rec.id, refNo: rec.refNo, note: 'Physical count adjustment' });
  }
  rec.status = 'approved';
  rec.approvedBy = actorName();
  rec.approvedOn = date;
  audit('status', 'Stock reconciliation', rec.refNo, 'Approved reconciliation and posted stock adjustments');
  return rec;
}
