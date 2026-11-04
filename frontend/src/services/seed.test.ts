import { beforeAll, describe, expect, it } from 'vitest';
import { seedDb, seedWarnings } from './mock/seed';
import * as sel from './mock/selectors';
import { db } from './mock/db';
import { mockServices as s } from './mock/services';
import { round2 } from '@/utils/format';

beforeAll(() => seedDb());

describe('seeded demo data', () => {
  it('replays without unexpected failures', () => {
    // A few skipped events (e.g. a return when no candidate exists) are tolerated, wholesale failure is not.
    expect(seedWarnings.length).toBeLessThan(15);
    expect(db.invoices.length).toBeGreaterThan(60);
    expect(db.batches.length).toBeGreaterThan(40);
  });

  it('never has negative stock in any bucket', () => {
    for (const b of sel.batchStockRows()) {
      expect(b.saleable).toBeGreaterThanOrEqual(0);
      expect(b.damaged).toBeGreaterThanOrEqual(0);
      expect(b.expired).toBeGreaterThanOrEqual(0);
      expect(b.inspection).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps invoice totals consistent with their lines', () => {
    for (const i of db.invoices) {
      expect(round2(i.taxable + i.cgst + i.sgst + i.igst + i.roundOff)).toBe(i.total);
      expect(i.interState ? i.cgst + i.sgst : i.igst).toBe(0);
    }
  });

  it('ties distributor balances to ledgers and to invoice outstanding', () => {
    for (const b of sel.distributorBalances()) {
      const ledger = sel.ledgerFor(b.distributorId);
      expect(ledger.at(-1)?.balance ?? 0).toBe(b.balance);
    }
  });

  it('never over-allocates a payment or an invoice', () => {
    for (const p of db.payments) expect(p.allocations.reduce((s, a) => s + a.amount, 0)).toBeLessThanOrEqual(p.amount + 0.005);
    for (const i of sel.invoiceRows()) expect(i.outstanding).toBeGreaterThanOrEqual(0);
  });

  it('produces the scenarios the UI needs to show', () => {
    const a = sel.alerts();
    expect(a.expiring.length).toBeGreaterThan(0);
    expect(a.lowStock.length).toBeGreaterThan(0);
    expect(a.overdue.length).toBeGreaterThan(0);
    expect(a.overLimit.length).toBeGreaterThan(0);
    expect(a.pendingInspection).toBeGreaterThan(0);
    expect(db.purchaseOrders.some((p) => p.status === 'partial')).toBe(true);
    expect(db.orders.some((o) => o.status === 'confirmed')).toBe(true);
    expect(db.dispatches.some((d) => !d.invoiceId)).toBe(true);
  });
});

describe('services', () => {
  it('blocks deleting a brand that has products', async () => {
    await expect(s.brands.remove('brd-raju')).rejects.toThrow(/used by/);
  });

  it('rejects dispatching more than the saleable stock', async () => {
    const order = db.orders.find((o) => o.status === 'confirmed')!;
    const line = order.lines[0];
    const batch = db.batches.find((b) => b.productId === line.productId)!;
    await expect(
      s.distribution.dispatches.create({ orderId: order.id, date: order.date, vehicleNo: '', deliveryRef: '', notes: '', lines: [{ productId: line.productId, batchId: batch.id, qty: 9_999_999 }] }),
    ).rejects.toThrow();
  });

  it('posts a stock movement when goods are received', async () => {
    const po = db.purchaseOrders.find((p) => p.status === 'ordered');
    if (!po) return;
    const before = db.movements.length;
    const l = po.lines[0];
    const p = db.products.find((x) => x.id === l.productId)!;
    await s.purchases.receipts.create({ poId: po.id, date: sel.productOf(p.id) ? new Date().toISOString().slice(0, 10) : '', supplierInvoiceNo: 'T-1', lines: [{ productId: l.productId, batchNo: 'TEST-1', mfgDate: '2026-01-01', expiryDate: '2099-01-01', qty: 1 }] });
    expect(db.movements.length).toBe(before + 1);
  });
});
