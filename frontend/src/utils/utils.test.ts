import { describe, expect, it } from 'vitest';
import { computeDocumentTotals, computeLineTax } from './gst';
import { valueStock } from './valuation';
import { parseCsv, toCsv } from './csv';
import { addDays, daysBetween, formatCurrency } from './format';

describe('GST', () => {
  it('splits intra-state tax into CGST and SGST', () => {
    const t = computeLineTax({ qty: 10, rate: 100, discountPct: 10, gstRate: 18 }, false);
    expect(t.taxable).toBe(900);
    expect(t.cgst).toBe(81);
    expect(t.sgst).toBe(81);
    expect(t.igst).toBe(0);
    expect(t.total).toBe(1062);
  });

  it('charges IGST for inter-state supply', () => {
    const t = computeLineTax({ qty: 3, rate: 33.33, discountPct: 0, gstRate: 5 }, true);
    expect(t.cgst).toBe(0);
    expect(t.igst).toBe(5);
  });

  it('rounds document total to the nearest rupee and reports the round-off', () => {
    const d = computeDocumentTotals([{ qty: 1, rate: 100.4, discountPct: 0, gstRate: 0 }], false);
    expect(d.total).toBe(100);
    expect(d.roundOff).toBe(-0.4);
  });
});

describe('valuation', () => {
  const layers = [
    { receivedQty: 100, unitCost: 10, receivedOn: '2026-01-01' },
    { receivedQty: 100, unitCost: 20, receivedOn: '2026-02-01' },
  ];
  it('FIFO costs remaining stock from the newest layers', () => {
    expect(valueStock('fifo', 100, layers).value).toBe(2000);
    expect(valueStock('fifo', 150, layers).value).toBe(2500);
  });
  it('weighted average uses the quantity-weighted cost', () => {
    expect(valueStock('weighted_average', 100, layers)).toEqual({ unitCost: 15, value: 1500 });
  });
});

describe('csv', () => {
  it('round-trips quoted values', () => {
    const csv = toCsv(['a', 'b'], [['x,y', 'say "hi"']]);
    expect(parseCsv(csv)).toEqual([['a', 'b'], ['x,y', 'say "hi"']]);
  });
  it('writes ISO dates as text cells so Excel does not show ####', () => {
    expect(toCsv(['d'], [['2026-10-28']])).toBe('d\r\n"=""2026-10-28"""');
    expect(parseCsv(toCsv(['d'], [['2026-10-28T10:15:00.000Z']]))[1][0]).toBe('="2026-10-28T10:15:00.000Z"');
    expect(toCsv(['n', 'm', 'x'], [[1234.5, '2026-10', 'INV-2026-0001']])).toBe('n,m,x\r\n1234.5,2026-10,INV-2026-0001');
  });
});

describe('dates and currency', () => {
  it('adds days and measures differences', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59);
  });
  it('formats INR with Indian grouping', () => {
    expect(formatCurrency(1234567.5)).toContain('12,34,567.50');
  });
});
