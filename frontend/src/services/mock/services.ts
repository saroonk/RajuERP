import type {
  AlertSummary,
  BatchStock,
  BrandReportRow,
  DashboardSummary,
  DateRange,
  DistributorPerfRow,
  DistributorStockReportRow,
  DistributorStockRow,
  ExpenseRow,
  GstSummary,
  ID,
  IncomeExpenseSummary,
  ModuleKey,
  PermissionLevel,
  ProductClass,
  ProductPerfRow,
  PurchaseRegisterRow,
  Role,
  SalesProfitReport,
  SalesProfitRow,
  SalesRegisterRow,
  SearchResult,
  User,
  ValuationRow,
  WriteOff,
} from '@/types';
import { addDays, formatNumber, inRange, lastMonths, monthKey, round2, startOfMonth, today } from '@/utils/format';
import { valueStock, type CostLayer } from '@/utils/valuation';
import type { CrudService, DistributorReportInput, ExpenseInput, ImportResult, Services, UserInput } from '../types';
import { actorName, audit, db, ensureNotReferenced, fail, must, nextDocNo, nextId, session, touch } from './db';
import * as ops from './ops';
import * as sel from './selectors';

const LATENCY = { min: 80, max: 220 };
const delay = () => new Promise<void>((res) => setTimeout(res, LATENCY.min + Math.random() * (LATENCY.max - LATENCY.min)));

/** Reads return deep copies so UI state can never alias (and silently mutate) the mock db. */
async function read<T>(fn: () => T): Promise<T> {
  await delay();
  return structuredClone(fn());
}

async function write<T>(fn: () => T): Promise<T> {
  await delay();
  try {
    return structuredClone(fn());
  } finally {
    touch();
  }
}

interface CrudOptions<T extends { id: ID }, I> {
  prefix: string;
  entity: string;
  get: () => T[];
  set: (rows: T[]) => void;
  nameOf: (row: T) => string;
  referenceKey?: string;
  unique?: { label: string; key: (row: Omit<T, 'id'>) => string }[];
  build?: (input: I) => Omit<T, 'id'>;
  sort?: (a: T, b: T) => number;
}

function crud<T extends { id: ID }, I = Omit<T, 'id'>>(o: CrudOptions<T, I>): CrudService<T, I> {
  const build = (input: I) => (o.build ? o.build(input) : (input as unknown as Omit<T, 'id'>));
  const checkUnique = (next: Omit<T, 'id'>, selfId?: ID) => {
    for (const u of o.unique ?? []) {
      const key = u.key(next).trim().toLowerCase();
      if (key && o.get().some((r) => r.id !== selfId && u.key(r).trim().toLowerCase() === key)) fail(`${u.label} "${u.key(next)}" already exists`);
    }
  };
  return {
    list: () => read(() => [...o.get()].sort(o.sort ?? (() => 0))),
    get: (id) => read(() => o.get().find((r) => r.id === id)),
    create: (input) =>
      write(() => {
        const row = { id: nextId(o.prefix), ...build(input) } as T;
        checkUnique(row);
        o.set([...o.get(), row]);
        audit('create', o.entity, o.nameOf(row), `Created ${o.entity.toLowerCase()} ${o.nameOf(row)}`);
        return row;
      }),
    update: (id, input) =>
      write(() => {
        const row = must(o.get().find((r) => r.id === id), o.entity);
        const next = { ...row, ...input } as T;
        checkUnique(next, id);
        Object.assign(row, next);
        audit('update', o.entity, o.nameOf(row), `Updated ${o.entity.toLowerCase()} ${o.nameOf(row)}`);
        return row;
      }),
    remove: (id) =>
      write(() => {
        const row = must(o.get().find((r) => r.id === id), o.entity);
        if (o.referenceKey) ensureNotReferenced(o.referenceKey, id, o.nameOf(row));
        o.set(o.get().filter((r) => r.id !== id));
        audit('delete', o.entity, o.nameOf(row), `Deleted ${o.entity.toLowerCase()} ${o.nameOf(row)}`);
      }),
  };
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/* ------------------------------- reports ------------------------------- */

const inR = (d: string, r: DateRange) => inRange(d, r.from, r.to);

function salesProfitability(range: DateRange): SalesProfitReport {
  const facts = sel.salesFacts().filter((f) => inR(f.date, range));
  const byInvoice = new Map<ID, SalesProfitRow>();
  for (const f of facts) {
    const inv = db.invoices.find((i) => i.id === f.invoiceId)!;
    let row = byInvoice.get(f.invoiceId);
    if (!row) {
      row = { invoiceId: inv.id, invoiceNo: inv.invoiceNo, date: inv.date, distributorName: sel.distributorOf(inv.distributorId)?.name ?? '', revenue: 0, cost: 0, margin: 0, marginPct: 0 };
      byInvoice.set(f.invoiceId, row);
    }
    row.revenue = round2(row.revenue + f.taxable);
    row.cost = round2(row.cost + f.cost);
  }
  const rows = [...byInvoice.values()].map((r) => ({ ...r, margin: round2(r.revenue - r.cost), marginPct: r.revenue ? round2(((r.revenue - r.cost) / r.revenue) * 100) : 0 }));
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.invoiceNo.localeCompare(a.invoiceNo));
  const months = new Map<string, { revenue: number; cost: number }>();
  for (const f of facts) {
    const m = months.get(monthKey(f.date)) ?? { revenue: 0, cost: 0 };
    m.revenue += f.taxable;
    m.cost += f.cost;
    months.set(monthKey(f.date), m);
  }
  const trend = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, revenue: round2(v.revenue), cost: round2(v.cost), margin: round2(v.revenue - v.cost) }));
  return { rows, trend };
}

function brandReport(range: DateRange): BrandReportRow[] {
  const facts = sel.salesFacts().filter((f) => inR(f.date, range));
  const stock = sel.productStockRows();
  return db.brands.map((b) => {
    const f = facts.filter((x) => x.brandId === b.id);
    const revenue = round2(f.reduce((s, x) => s + x.taxable, 0));
    const cost = round2(f.reduce((s, x) => s + x.cost, 0));
    const s = stock.filter((x) => x.brandId === b.id);
    return {
      brandId: b.id,
      brandName: b.name,
      type: b.type,
      qtySold: f.reduce((a, x) => a + x.qty, 0),
      revenue,
      cost,
      margin: round2(revenue - cost),
      marginPct: revenue ? round2(((revenue - cost) / revenue) * 100) : 0,
      stockQty: s.reduce((a, x) => a + x.available, 0),
      stockValue: round2(s.reduce((a, x) => a + x.value, 0)),
    };
  });
}

function productReport(range: DateRange): ProductPerfRow[] {
  const facts = sel.salesFacts().filter((f) => inR(f.date, range));
  const stock = new Map(sel.productStockRows().map((s) => [s.productId, s]));
  const lastSale = new Map<ID, string>();
  for (const inv of db.invoices) for (const l of inv.lines) if ((lastSale.get(l.productId) ?? '') < inv.date) lastSale.set(l.productId, inv.date);
  const rows = db.products
    .filter((p) => p.active)
    .map((p) => {
      const f = facts.filter((x) => x.productId === p.id);
      const revenue = round2(f.reduce((s, x) => s + x.taxable, 0));
      return {
        productId: p.id,
        sku: p.sku,
        name: p.name,
        brandName: sel.brandOf(p.brandId)?.name ?? '',
        qtySold: f.reduce((s, x) => s + x.qty, 0),
        revenue,
        margin: round2(revenue - f.reduce((s, x) => s + x.cost, 0)),
        stockOnHand: stock.get(p.id)?.available ?? 0,
        lastSaleDate: lastSale.get(p.id) ?? null,
        classification: 'average' as ProductClass,
      };
    });
  const sellers = rows.filter((r) => r.qtySold > 0).sort((a, b) => b.revenue - a.revenue);
  const top = Math.max(1, Math.ceil(sellers.length * 0.25));
  const bottomStart = Math.floor(sellers.length * 0.6);
  sellers.forEach((r, i) => {
    r.classification = i < top ? 'high_selling' : i >= bottomStart ? 'slow_moving' : 'average';
  });
  for (const r of rows) if (r.qtySold <= 0) r.classification = 'low_performing';
  return rows.sort((a, b) => b.revenue - a.revenue);
}

function distributorReport(range: DateRange): DistributorPerfRow[] {
  const balances = new Map(sel.distributorBalances().map((b) => [b.distributorId, b]));
  const fromPeriod = monthKey(range.from);
  const toPeriod = monthKey(range.to);
  return db.distributors.map((d) => {
    const invoices = db.invoices.filter((i) => i.distributorId === d.id && inR(i.date, range));
    const taxable = round2(invoices.reduce((s, i) => s + i.taxable, 0));
    const returns = db.salesReturns.filter((r) => r.distributorId === d.id && inR(r.date, range));
    const returnsValue = round2(returns.reduce((s, r) => s + sel.salesReturnRow(r).value, 0));
    const reports = db.stockReports.filter((x) => x.distributorId === d.id && x.period >= fromPeriod && x.period <= toPeriod);
    return {
      distributorId: d.id,
      distributorName: d.name,
      type: d.type,
      invoices: invoices.length,
      taxable,
      invoiced: round2(invoices.reduce((s, i) => s + i.total, 0)),
      collected: round2(db.payments.filter((p) => p.distributorId === d.id && inR(p.date, range)).reduce((s, p) => s + p.amount, 0)),
      outstanding: balances.get(d.id)?.balance ?? 0,
      returnsValue,
      returnPct: taxable ? round2((returnsValue / taxable) * 100) : 0,
      reportedSales: reports.length ? reports.reduce((s, x) => s + x.reportedSales, 0) : null,
    };
  });
}

function purchaseRegister(range: DateRange): PurchaseRegisterRow[] {
  return db.goodsReceipts
    .filter((g) => inR(g.date, range))
    .map((g) => {
      const s = sel.supplierOf(g.supplierId);
      const inter = !!s && s.state !== db.settings.state;
      return {
        grnId: g.id,
        grnNo: g.grnNo,
        date: g.date,
        supplierName: s?.name ?? '',
        gstin: s?.gstin ?? '',
        supplierInvoiceNo: g.supplierInvoiceNo,
        taxable: g.taxable,
        cgst: inter ? 0 : round2(g.tax / 2),
        sgst: inter ? 0 : round2(g.tax - round2(g.tax / 2)),
        igst: inter ? g.tax : 0,
        total: g.total,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function salesRegister(range: DateRange): SalesRegisterRow[] {
  return db.invoices
    .filter((i) => inR(i.date, range))
    .map((i) => ({
      invoiceId: i.id,
      invoiceNo: i.invoiceNo,
      date: i.date,
      distributorName: sel.distributorOf(i.distributorId)?.name ?? '',
      gstin: sel.distributorOf(i.distributorId)?.gstin ?? '',
      taxable: i.taxable,
      cgst: i.cgst,
      sgst: i.sgst,
      igst: i.igst,
      roundOff: i.roundOff,
      total: i.total,
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.invoiceNo.localeCompare(a.invoiceNo));
}

function gstSummary(range: DateRange): GstSummary {
  const invoices = db.invoices.filter((i) => inR(i.date, range));
  const rates = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
  const months = new Map<string, { taxable: number; tax: number }>();
  for (const i of invoices) {
    for (const l of i.lines) {
      const r = rates.get(l.gstRate) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      r.taxable += l.taxable;
      r.cgst += l.cgst;
      r.sgst += l.sgst;
      r.igst += l.igst;
      rates.set(l.gstRate, r);
      const m = months.get(monthKey(i.date)) ?? { taxable: 0, tax: 0 };
      m.taxable += l.taxable;
      m.tax += l.cgst + l.sgst + l.igst;
      months.set(monthKey(i.date), m);
    }
  }
  const taxable = round2(invoices.reduce((s, i) => s + i.taxable, 0));
  const cgst = round2(invoices.reduce((s, i) => s + i.cgst, 0));
  const sgst = round2(invoices.reduce((s, i) => s + i.sgst, 0));
  const igst = round2(invoices.reduce((s, i) => s + i.igst, 0));
  const noteTax = (type: 'credit' | 'debit') => round2(db.notes.filter((n) => n.type === type && inR(n.date, range)).reduce((s, n) => s + n.cgst + n.sgst + n.igst, 0));
  const creditNoteTax = noteTax('credit');
  const debitNoteTax = noteTax('debit');
  const grns = db.goodsReceipts.filter((g) => inR(g.date, range));
  const rets = db.supplierReturns.filter((g) => inR(g.date, range));
  return {
    byRate: [...rates.entries()].sort(([a], [b]) => a - b).map(([rate, v]) => ({ rate, taxable: round2(v.taxable), cgst: round2(v.cgst), sgst: round2(v.sgst), igst: round2(v.igst), tax: round2(v.cgst + v.sgst + v.igst) })),
    byMonth: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, taxable: round2(v.taxable), tax: round2(v.tax) })),
    output: { taxable, cgst, sgst, igst, tax: round2(cgst + sgst + igst), creditNoteTax, debitNoteTax, netTax: round2(cgst + sgst + igst - creditNoteTax + debitNoteTax) },
    input: {
      taxable: round2(grns.reduce((s, g) => s + g.taxable, 0) - rets.reduce((s, g) => s + g.taxable, 0)),
      tax: round2(grns.reduce((s, g) => s + g.tax, 0) - rets.reduce((s, g) => s + g.tax, 0)),
    },
  };
}

/* ------------------------------ accounting ------------------------------ */

function incomeExpenseSummary(range: DateRange): IncomeExpenseSummary {
  const salesTaxable = round2(db.invoices.filter((i) => inR(i.date, range)).reduce((s, i) => s + i.taxable, 0));
  const noteTaxable = (type: 'credit' | 'debit') => round2(db.notes.filter((n) => n.type === type && inR(n.date, range)).reduce((s, n) => s + n.taxable, 0));
  const creditNotesTaxable = noteTaxable('credit');
  const debitNotesTaxable = noteTaxable('debit');
  const purchasesTaxable = round2(db.goodsReceipts.filter((g) => inR(g.date, range)).reduce((s, g) => s + g.taxable, 0));
  const supplierReturnsTaxable = round2(db.supplierReturns.filter((g) => inR(g.date, range)).reduce((s, g) => s + g.taxable, 0));
  const expenses = db.expenses.filter((e) => inR(e.date, range));
  const expensesByCategory = db.expenseCategories
    .map((c) => ({ categoryId: c.id, categoryName: c.name, amount: round2(expenses.filter((e) => e.categoryId === c.id).reduce((s, e) => s + e.amount, 0)) }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const totalExpenses = round2(expensesByCategory.reduce((s, c) => s + c.amount, 0));
  const netIncome = round2(salesTaxable - creditNotesTaxable + debitNotesTaxable);
  const netPurchases = round2(purchasesTaxable - supplierReturnsTaxable);

  const keys = new Set<string>();
  const cursor = startOfMonth(range.from);
  for (let d = cursor; d <= range.to; d = addDays(startOfMonth(addDays(d, 32)), 0)) keys.add(monthKey(d));
  const months = [...keys].sort().map((month) => {
    const inM = (d: string) => monthKey(d) === month && inR(d, range);
    const income =
      db.invoices.filter((i) => inM(i.date)).reduce((s, i) => s + i.taxable, 0) -
      db.notes.filter((n) => n.type === 'credit' && inM(n.date)).reduce((s, n) => s + n.taxable, 0) +
      db.notes.filter((n) => n.type === 'debit' && inM(n.date)).reduce((s, n) => s + n.taxable, 0);
    const purchases = db.goodsReceipts.filter((g) => inM(g.date)).reduce((s, g) => s + g.taxable, 0) - db.supplierReturns.filter((g) => inM(g.date)).reduce((s, g) => s + g.taxable, 0);
    return { month, income: round2(income), purchases: round2(purchases), expenses: round2(db.expenses.filter((e) => inM(e.date)).reduce((s, e) => s + e.amount, 0)) };
  });

  return {
    salesTaxable,
    creditNotesTaxable,
    debitNotesTaxable,
    netIncome,
    purchasesTaxable,
    supplierReturnsTaxable,
    netPurchases,
    expensesByCategory,
    totalExpenses,
    operatingResult: round2(netIncome - netPurchases - totalExpenses),
    collections: round2(db.payments.filter((p) => inR(p.date, range)).reduce((s, p) => s + p.amount, 0)),
    supplierPayments: round2(db.supplierPayments.filter((p) => inR(p.date, range)).reduce((s, p) => s + p.amount, 0)),
    months,
  };
}

function expenseRow(e: (typeof db.expenses)[number]): ExpenseRow {
  return { ...e, categoryName: db.expenseCategories.find((c) => c.id === e.categoryId)?.name ?? '' };
}

function validateExpense(i: ExpenseInput) {
  must(db.expenseCategories.find((c) => c.id === i.categoryId), 'Expense category');
  if (!(i.amount > 0)) fail('Amount must be greater than zero');
  if (!i.payee.trim()) fail('Enter the payee');
}

/* ------------------------------- valuation ------------------------------- */

function valuation(method: 'fifo' | 'weighted_average'): ValuationRow[] {
  const batches = sel.batchStockRows();
  return db.products.map((p) => {
    const mine = batches.filter((b) => b.productId === p.id);
    const qty = mine.reduce((s, b) => s + b.saleable, 0);
    const layers: CostLayer[] = mine.map((b) => ({ receivedQty: b.receivedQty, unitCost: b.costPrice, receivedOn: b.receivedOn }));
    const v = valueStock(method, qty, layers);
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      brandName: sel.brandOf(p.brandId)?.name ?? '',
      qty,
      unitCost: v.unitCost,
      value: v.value,
      heldValue: round2(mine.reduce((s, b) => s + (b.damaged + b.expired + b.inspection) * b.costPrice, 0)),
    };
  });
}

/* ------------------------------- dashboard ------------------------------- */

function dashboard(): DashboardSummary {
  const now = today();
  const thisMonth = monthKey(now);
  const prevMonth = monthKey(addDays(startOfMonth(now), -1));
  const al: AlertSummary = sel.alerts();
  const invoices = sel.invoiceRows();
  const balances = sel.distributorBalances();
  const taxableIn = (m: string) => round2(db.invoices.filter((i) => monthKey(i.date) === m).reduce((s, i) => s + i.taxable, 0));
  const supplierOutstanding = sel.supplierBalances().reduce((s, x) => s + Math.max(0, x.outstanding), 0);
  const months = lastMonths(6, now);
  const range: DateRange = { from: `${months[0]}-01`, to: now };
  const facts = sel.salesFacts().filter((f) => inR(f.date, range));
  const brandTotals = new Map<ID, number>();
  for (const f of facts.filter((x) => monthKey(x.date) >= months[3])) brandTotals.set(f.brandId, (brandTotals.get(f.brandId) ?? 0) + f.taxable);

  return {
    kpis: {
      stockValue: round2(sel.productStockRows().reduce((s, p) => s + p.value, 0)),
      salesMonth: taxableIn(thisMonth),
      salesPrevMonth: taxableIn(prevMonth),
      purchasesMonth: round2(db.goodsReceipts.filter((g) => monthKey(g.date) === thisMonth).reduce((s, g) => s + g.taxable, 0)),
      receivables: round2(balances.reduce((s, b) => s + Math.max(0, b.balance), 0)),
      overdueReceivables: round2(al.overdue.reduce((s, i) => s + i.outstanding, 0)),
      payables: round2(supplierOutstanding),
      collectionsMonth: round2(db.payments.filter((p) => monthKey(p.date) === thisMonth).reduce((s, p) => s + p.amount, 0)),
      expiringBatches: al.expiring.length,
      expiredBatches: al.expired.length,
      lowStockProducts: al.lowStock.length,
      openOrders: db.orders.filter((o) => o.status === 'confirmed' || o.status === 'partially_dispatched').length,
    },
    monthly: months.map((m) => ({
      month: m,
      sales: taxableIn(m),
      purchases: round2(db.goodsReceipts.filter((g) => monthKey(g.date) === m).reduce((s, g) => s + g.taxable, 0)),
      collections: round2(db.payments.filter((p) => monthKey(p.date) === m).reduce((s, p) => s + p.amount, 0)),
    })),
    salesByBrand: [...brandTotals.entries()].map(([id, value]) => ({ name: sel.brandOf(id)?.name ?? id, value: round2(value) })).sort((a, b) => b.value - a.value),
    topDistributors: db.distributors
      .map((d) => ({
        name: d.name,
        sales: round2(db.invoices.filter((i) => i.distributorId === d.id && monthKey(i.date) >= months[3]).reduce((s, i) => s + i.taxable, 0)),
        outstanding: Math.max(0, balances.find((b) => b.distributorId === d.id)?.balance ?? 0),
      }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 6),
    recentInvoices: [...invoices].sort((a, b) => b.date.localeCompare(a.date) || b.invoiceNo.localeCompare(a.invoiceNo)).slice(0, 6),
    expiringSoon: [...al.expired, ...al.expiring].slice(0, 6),
    overdue: al.overdue.slice(0, 6),
    lowStock: al.lowStock.slice(0, 6),
  };
}

/* -------------------------------- search -------------------------------- */

function search(q: string): SearchResult[] {
  const term = q.trim().toLowerCase();
  if (term.length < 2) return [];
  const has = (...v: (string | undefined)[]) => v.some((x) => x?.toLowerCase().includes(term));
  const out: SearchResult[] = [];
  const add = (r: SearchResult, bucket: SearchResult[], max = 4) => bucket.length < max && bucket.push(r);
  const groups: Record<string, SearchResult[]> = {};
  const g = (k: string) => (groups[k] ??= []);
  db.products.forEach((p) => has(p.name, p.sku) && add({ type: 'Product', label: p.name, sub: p.sku, href: '/products' }, g('p')));
  sel.batchStockRows().forEach((b) => has(b.batchNo, b.productName) && add({ type: 'Batch', label: `${b.batchNo} · ${b.productName}`, sub: `${formatNumber(b.saleable)} saleable`, href: '/inventory/batches' }, g('b')));
  db.invoices.forEach((i) => has(i.invoiceNo, sel.distributorOf(i.distributorId)?.name) && add({ type: 'Invoice', label: i.invoiceNo, sub: sel.distributorOf(i.distributorId)?.name ?? '', href: `/sales/invoices/${i.id}` }, g('i')));
  db.suppliers.forEach((s) => has(s.name, s.gstin, s.city) && add({ type: 'Supplier', label: s.name, sub: s.city, href: '/purchases/suppliers' }, g('s')));
  db.distributors.forEach((d) => has(d.name, d.code, d.gstin, d.city) && add({ type: 'Distributor', label: d.name, sub: `${d.code} · ${d.city}`, href: `/distribution/distributors/${d.id}` }, g('d')));
  db.purchaseOrders.forEach((p) => has(p.poNo) && add({ type: 'Purchase order', label: p.poNo, sub: sel.supplierOf(p.supplierId)?.name ?? '', href: `/purchases/orders/${p.id}` }, g('po')));
  db.orders.forEach((o) => has(o.orderNo) && add({ type: 'Order', label: o.orderNo, sub: sel.distributorOf(o.distributorId)?.name ?? '', href: `/distribution/orders/${o.id}` }, g('o')));
  db.payments.forEach((p) => has(p.receiptNo, p.reference) && add({ type: 'Payment', label: p.receiptNo, sub: sel.distributorOf(p.distributorId)?.name ?? '', href: `/accounts/payments/${p.id}` }, g('pay')));
  for (const k of Object.keys(groups)) out.push(...groups[k]);
  return out;
}

/* ------------------------------ stock reports ------------------------------ */

function stockRows(): DistributorStockRow[] {
  const key = (d: ID, p: ID) => `${d}|${p}`;
  const rows = new Map<string, DistributorStockRow>();
  const ensure = (d: ID, p: ID) => {
    let r = rows.get(key(d, p));
    if (!r) {
      const prod = sel.productOf(p);
      r = { distributorId: d, distributorName: sel.distributorOf(d)?.name ?? d, productId: p, productName: prod?.name ?? p, sku: prod?.sku ?? '', dispatched: 0, returnedToUs: 0, reportedSales: null, reportedRemaining: null, lastPeriod: null, unreconciled: null };
      rows.set(key(d, p), r);
    }
    return r;
  };
  for (const dsp of db.dispatches) for (const l of dsp.lines) ensure(dsp.distributorId, l.productId).dispatched += l.qty;
  for (const ret of db.salesReturns) for (const l of ret.lines) ensure(ret.distributorId, l.productId).returnedToUs += l.qty;
  const latest = new Map<string, string>();
  for (const rep of [...db.stockReports].sort((a, b) => a.period.localeCompare(b.period))) {
    const r = ensure(rep.distributorId, rep.productId);
    r.reportedSales = (r.reportedSales ?? 0) + rep.reportedSales;
    if ((latest.get(key(rep.distributorId, rep.productId)) ?? '') <= rep.period) {
      latest.set(key(rep.distributorId, rep.productId), rep.period);
      r.reportedRemaining = rep.remainingStock;
      r.lastPeriod = rep.period;
    }
  }
  for (const r of rows.values()) if (r.reportedSales !== null) r.unreconciled = r.dispatched - r.returnedToUs - r.reportedSales - (r.reportedRemaining ?? 0);
  return [...rows.values()].sort((a, b) => a.distributorName.localeCompare(b.distributorName) || a.productName.localeCompare(b.productName));
}

function validateReport(i: DistributorReportInput) {
  must(sel.distributorOf(i.distributorId), 'Distributor');
  must(sel.productOf(i.productId), 'Product');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(i.period)) fail('Period must be in YYYY-MM format');
  for (const n of [i.reportedSales, i.remainingStock, i.returned]) if (!Number.isFinite(n) || n < 0) fail('Quantities cannot be negative');
}

function upsertReport(i: DistributorReportInput, source: 'manual' | 'import') {
  validateReport(i);
  const existing = db.stockReports.find((r) => r.distributorId === i.distributorId && r.productId === i.productId && r.period === i.period);
  if (existing) return Object.assign(existing, i, { reportedOn: today(), source });
  const rep = { id: nextId('dsr'), ...i, reportedOn: today(), source };
  db.stockReports.push(rep);
  return rep;
}

/* ------------------------------ implementation ------------------------------ */

const strip = ({ lineCount: _l, totalQty: _t, ...rest }: WriteOff & { lineCount: number; totalQty: number }): WriteOff => rest;
void strip;

const SESSION_KEY = 'rajuerp.session';

export const mockServices: Services = {
  auth: {
    login: (email, password) =>
      write(() => {
        const u = db.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
        if (!u || !password) fail('Invalid email or password');
        if (!u.active) fail('This account is inactive. Contact an administrator.');
        u.lastLogin = new Date().toISOString();
        session.userId = u.id;
        try {
          localStorage.setItem(SESSION_KEY, u.id);
        } catch {
          /* private mode */
        }
        audit('login', 'User', u.name, `${u.name} signed in`);
        return u;
      }),
    logout: (userId) =>
      write(() => {
        const u = db.users.find((x) => x.id === userId);
        if (u) audit('login', 'User', u.name, `${u.name} signed out`);
        try {
          localStorage.removeItem(SESSION_KEY);
        } catch {
          /* ignore */
        }
      }),
    getUser: (id) =>
      read(() => {
        const u = db.users.find((x) => x.id === id);
        if (u) session.userId = u.id;
        return u;
      }),
    restore: () =>
      read(() => {
        let id: string | null = null;
        try {
          id = localStorage.getItem(SESSION_KEY);
        } catch {
          /* ignore */
        }
        const u = id ? db.users.find((x) => x.id === id && x.active) : undefined;
        if (u) session.userId = u.id;
        return u;
      }),
    demoUsers: () => read(() => db.users.filter((u) => u.active)),
  },
  lookups: {
    all: () =>
      read(() => ({
        brands: [...db.brands].sort(byName),
        categories: [...db.categories].sort(byName),
        units: [...db.units],
        products: [...db.products].sort(byName),
        suppliers: [...db.suppliers].sort(byName),
        distributors: [...db.distributors].sort(byName),
        expenseCategories: [...db.expenseCategories].sort(byName),
      })),
  },
  search: (q) => read(() => search(q)),
  brands: crud({ prefix: 'brd', entity: 'Brand', get: () => db.brands, set: (r) => (db.brands = r), nameOf: (r) => r.name, referenceKey: 'brands', unique: [{ label: 'Brand', key: (r) => r.name }], sort: byName }),
  categories: crud({ prefix: 'cat', entity: 'Category', get: () => db.categories, set: (r) => (db.categories = r), nameOf: (r) => r.name, referenceKey: 'categories', unique: [{ label: 'Category', key: (r) => `${r.parentId ?? ''}/${r.name}` }], sort: byName }),
  units: crud({ prefix: 'unit', entity: 'Unit', get: () => db.units, set: (r) => (db.units = r), nameOf: (r) => r.name, referenceKey: 'units', unique: [{ label: 'Unit', key: (r) => r.code }] }),
  unitConversions: crud({
    prefix: 'conv',
    entity: 'Unit conversion',
    get: () => db.unitConversions,
    set: (r) => (db.unitConversions = r),
    nameOf: (r) => `${r.fromUnitId} to ${r.toUnitId}`,
    unique: [{ label: 'Conversion', key: (r) => `${r.fromUnitId}>${r.toUnitId}` }],
  }),
  products: crud({ prefix: 'prd', entity: 'Product', get: () => db.products, set: (r) => (db.products = r), nameOf: (r) => r.name, referenceKey: 'products', unique: [{ label: 'SKU', key: (r) => r.sku }], sort: byName }),
  suppliers: crud({ prefix: 'sup', entity: 'Supplier', get: () => db.suppliers, set: (r) => (db.suppliers = r), nameOf: (r) => r.name, referenceKey: 'suppliers', unique: [{ label: 'Supplier', key: (r) => r.name }], sort: byName }),
  distributors: crud({
    prefix: 'dst',
    entity: 'Distributor',
    get: () => db.distributors,
    set: (r) => (db.distributors = r),
    nameOf: (r) => r.name,
    referenceKey: 'distributors',
    unique: [{ label: 'Distributor code', key: (r) => r.code }, { label: 'Distributor', key: (r) => r.name }],
    build: (i) => ({ ...i, code: i.code?.trim() || `D${String(db.distributors.length + 1).padStart(3, '0')}` }),
    sort: byName,
  }),
  distributorPrices: crud({
    prefix: 'dpr',
    entity: 'Distributor price',
    get: () => db.distributorPrices,
    set: (r) => (db.distributorPrices = r),
    nameOf: (r) => `${sel.distributorOf(r.distributorId)?.name ?? ''} / ${sel.productName(r.productId)}`,
    unique: [{ label: 'Price for this distributor and product', key: (r) => `${r.distributorId}|${r.productId}` }],
  }),

  inventory: {
    stockByProduct: () => read(() => sel.productStockRows()),
    batchStock: () => read(() => sel.batchStockRows()),
    movements: () =>
      read(() =>
        [...db.movements]
          .reverse()
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((m) => ({ ...m, productName: sel.productName(m.productId), sku: sel.productOf(m.productId)?.sku ?? '', batchNo: sel.batchOf(m.batchId)?.batchNo ?? '' })),
      ),
    valuation: (method) => read(() => valuation(method)),
    alerts: () => read(() => sel.alerts()),
    writeOffs: () => read(() => [...db.writeOffs].reverse().map((w) => ({ ...w, lineCount: w.lines.length, totalQty: w.lines.reduce((s, l) => s + l.qty, 0) }))),
    createWriteOff: (input) => write(() => ops.createWriteOff(input)),
    reconciliations: () => read(() => [...db.reconciliations].reverse().map((r) => ({ ...r, totalVariance: r.lines.reduce((s, l) => s + (l.appliedDiff ?? l.physicalQty - l.systemQty), 0) }))),
    getReconciliation: (id) => read(() => db.reconciliations.find((r) => r.id === id)),
    createReconciliation: (input) => write(() => ops.createReconciliation(input)),
    approveReconciliation: (id) => write(() => ops.approveReconciliation(id)),
    deleteReconciliation: (id) =>
      write(() => {
        const r = must(db.reconciliations.find((x) => x.id === id), 'Reconciliation');
        if (r.status === 'approved') fail('Approved reconciliations cannot be deleted');
        db.reconciliations = db.reconciliations.filter((x) => x.id !== id);
        audit('delete', 'Stock reconciliation', r.refNo, `Deleted draft reconciliation ${r.refNo}`);
      }),
    suggestAllocation: (productId, qty, date, exclude) => read(() => ops.suggestAllocation(productId, qty, date, exclude)),
    dispatchableBatches: (productId, date) => {
      return read(() => {
        const ids = new Set(sel.dispatchableOn(productId, date).map((x) => x.batch.id));
        return sel.batchStockRows().filter((b) => ids.has(b.id)).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)) as BatchStock[];
      });
    },
    getBatch: (id) => read(() => sel.batchOf(id)),
  },

  purchases: {
    orders: {
      list: () => read(() => db.purchaseOrders.map(sel.poRow).sort((a, b) => b.date.localeCompare(a.date) || b.poNo.localeCompare(a.poNo))),
      get: (id) => read(() => { const p = db.purchaseOrders.find((x) => x.id === id); return p ? sel.poRow(p) : undefined; }),
      create: (input) => write(() => sel.poRow(ops.createPO(input))),
      update: (id, input) => write(() => sel.poRow(ops.updatePO(id, input))),
      setStatus: (id, status) => write(() => sel.poRow(ops.setPOStatus(id, status))),
      remove: (id) => write(() => ops.deletePO(id)),
    },
    receipts: {
      list: () => read(() => db.goodsReceipts.map(sel.grnRow).sort((a, b) => b.date.localeCompare(a.date) || b.grnNo.localeCompare(a.grnNo))),
      get: (id) => read(() => { const g = db.goodsReceipts.find((x) => x.id === id); return g ? sel.grnRow(g) : undefined; }),
      create: (input) => write(() => sel.grnRow(ops.receiveGoods(input))),
    },
    returns: {
      list: () => read(() => db.supplierReturns.map(sel.supplierReturnRow).sort((a, b) => b.date.localeCompare(a.date))),
      get: (id) => read(() => { const r = db.supplierReturns.find((x) => x.id === id); return r ? sel.supplierReturnRow(r) : undefined; }),
      create: (input) => write(() => sel.supplierReturnRow(ops.createSupplierReturn(input))),
    },
    payments: {
      list: () => read(() => db.supplierPayments.map(sel.supplierPaymentRow).sort((a, b) => b.date.localeCompare(a.date))),
      create: (input) => write(() => sel.supplierPaymentRow(ops.createSupplierPayment(input))),
    },
    outstanding: () => read(() => sel.supplierBalances()),
  },

  distribution: {
    orders: {
      list: () => read(() => db.orders.map(sel.orderRow).sort((a, b) => b.date.localeCompare(a.date) || b.orderNo.localeCompare(a.orderNo))),
      get: (id) => read(() => { const o = db.orders.find((x) => x.id === id); return o ? sel.orderRow(o) : undefined; }),
      create: (input) => write(() => sel.orderRow(ops.createOrder(input))),
      update: (id, input) => write(() => sel.orderRow(ops.updateOrder(id, input))),
      confirm: (id) => write(() => sel.orderRow(ops.setOrderStatus(id, 'confirmed'))),
      cancel: (id) => write(() => sel.orderRow(ops.setOrderStatus(id, 'cancelled'))),
      remove: (id) => write(() => ops.deleteOrder(id)),
    },
    dispatches: {
      list: () => read(() => db.dispatches.map(sel.dispatchRow).sort((a, b) => b.date.localeCompare(a.date) || b.dispatchNo.localeCompare(a.dispatchNo))),
      get: (id) => read(() => { const d = db.dispatches.find((x) => x.id === id); return d ? sel.dispatchRow(d) : undefined; }),
      create: (input) => write(() => sel.dispatchRow(ops.createDispatch(input))),
    },
    stock: () => read(stockRows),
    stockReports: () =>
      read((): DistributorStockReportRow[] =>
        [...db.stockReports]
          .sort((a, b) => b.period.localeCompare(a.period))
          .map((r) => ({ ...r, distributorName: sel.distributorOf(r.distributorId)?.name ?? '', productName: sel.productName(r.productId), sku: sel.productOf(r.productId)?.sku ?? '' })),
      ),
    addStockReport: (input) =>
      write(() => {
        const r = upsertReport(input, 'manual');
        audit('create', 'Distributor stock report', sel.distributorOf(r.distributorId)?.name ?? '', `Recorded reported sales for ${sel.productName(r.productId)} (${r.period})`);
        return r;
      }),
    importStockReports: (rows) =>
      write((): ImportResult => {
        const result: ImportResult = { imported: 0, errors: [] };
        const body = rows.length && /distributor/i.test(rows[0][0] ?? '') ? rows.slice(1) : rows;
        const offset = body.length === rows.length ? 1 : 2;
        body.forEach((cols, idx) => {
          const row = idx + offset;
          try {
            const [code, sku, period, sales, remaining, returned] = cols.map((c) => c.trim());
            const d = db.distributors.find((x) => x.code.toLowerCase() === code?.toLowerCase() || x.name.toLowerCase() === code?.toLowerCase());
            if (!d) fail(`Unknown distributor "${code}"`);
            const p = db.products.find((x) => x.sku.toLowerCase() === sku?.toLowerCase());
            if (!p) fail(`Unknown SKU "${sku}"`);
            upsertReport({ distributorId: d.id, productId: p.id, period, reportedSales: Number(sales), remainingStock: Number(remaining), returned: Number(returned || 0) }, 'import');
            result.imported++;
          } catch (e) {
            result.errors.push({ row, message: e instanceof Error ? e.message : 'Invalid row' });
          }
        });
        if (result.imported) audit('create', 'Distributor stock report', 'Import', `Imported ${result.imported} distributor stock report rows`);
        return result;
      }),
    deleteStockReport: (id) =>
      write(() => {
        must(db.stockReports.find((r) => r.id === id), 'Stock report');
        db.stockReports = db.stockReports.filter((r) => r.id !== id);
      }),
  },

  sales: {
    invoices: {
      list: () => read(() => sel.invoiceRows().sort((a, b) => b.date.localeCompare(a.date) || b.invoiceNo.localeCompare(a.invoiceNo))),
      get: (id) => read(() => sel.invoiceRowById(id)),
      uninvoicedDispatches: () => read(() => db.dispatches.filter((d) => !d.invoiceId).map(sel.dispatchRow).sort((a, b) => b.date.localeCompare(a.date))),
      createFromDispatch: (dispatchId, date) => write(() => sel.invoiceRowById(ops.createInvoiceFromDispatch(dispatchId, date).id)!),
    },
    notes: {
      list: () => read(() => db.notes.map(sel.noteRow).sort((a, b) => b.date.localeCompare(a.date) || b.noteNo.localeCompare(a.noteNo))),
      create: (input) => write(() => sel.noteRow(ops.createNote(input))),
    },
    returns: {
      list: () => read(() => db.salesReturns.map(sel.salesReturnRow).sort((a, b) => b.date.localeCompare(a.date) || b.returnNo.localeCompare(a.returnNo))),
      get: (id) => read(() => { const r = db.salesReturns.find((x) => x.id === id); return r ? sel.salesReturnRow(r) : undefined; }),
      returnableLines: (invoiceId) => read(() => ops.returnableLines(invoiceId)),
      create: (input) => write(() => sel.salesReturnRow(ops.createSalesReturn(input))),
      reclassify: (id, lineIndex, to, note) => write(() => sel.salesReturnRow(ops.reclassifyReturnLine(id, lineIndex, to, note))),
    },
  },

  accounts: {
    balances: () => read(() => sel.distributorBalances().sort((a, b) => b.balance - a.balance)),
    ledger: (id) => read(() => sel.ledgerFor(id)),
    openInvoices: (id) => read(() => sel.openInvoices(id)),
    suggestAllocations: (id, amount) => read(() => ops.suggestAllocations(amount, sel.openInvoices(id))),
    payments: {
      list: () => read(() => db.payments.map(sel.paymentRow).sort((a, b) => b.date.localeCompare(a.date) || b.receiptNo.localeCompare(a.receiptNo))),
      get: (id) => read(() => { const p = db.payments.find((x) => x.id === id); return p ? sel.paymentRow(p) : undefined; }),
      create: (input) => write(() => sel.paymentRow(ops.createPayment(input))),
      allocate: (id, allocations) => write(() => sel.paymentRow(ops.allocatePayment(id, allocations))),
    },
    expenses: {
      list: () => read(() => db.expenses.map(expenseRow).sort((a, b) => b.date.localeCompare(a.date) || b.expenseNo.localeCompare(a.expenseNo))),
      create: (input) =>
        write(() => {
          validateExpense(input);
          const e = { id: nextId('exp'), expenseNo: nextDocNo('expense', input.date), ...input };
          db.expenses.push(e);
          audit('create', 'Expense', e.expenseNo, `Recorded expense of ₹${formatNumber(e.amount)}`, input.date);
          return expenseRow(e);
        }),
      update: (id, input) =>
        write(() => {
          validateExpense(input);
          const e = must(db.expenses.find((x) => x.id === id), 'Expense');
          Object.assign(e, input);
          audit('update', 'Expense', e.expenseNo, 'Updated expense');
          return expenseRow(e);
        }),
      remove: (id) =>
        write(() => {
          const e = must(db.expenses.find((x) => x.id === id), 'Expense');
          db.expenses = db.expenses.filter((x) => x.id !== id);
          audit('delete', 'Expense', e.expenseNo, 'Deleted expense');
        }),
    },
    expenseCategories: crud({ prefix: 'exc', entity: 'Expense category', get: () => db.expenseCategories, set: (r) => (db.expenseCategories = r), nameOf: (r) => r.name, referenceKey: 'expenseCategories', unique: [{ label: 'Category', key: (r) => r.name }], sort: byName }),
    summary: (range) => read(() => incomeExpenseSummary(range)),
  },

  reports: {
    salesProfitability: (r) => read(() => salesProfitability(r)),
    brands: (r) => read(() => brandReport(r) as BrandReportRow[]),
    products: (r) => read(() => productReport(r)),
    distributors: (r) => read(() => distributorReport(r)),
    purchaseRegister: (r) => read(() => purchaseRegister(r) as PurchaseRegisterRow[]),
    salesRegister: (r) => read(() => salesRegister(r) as SalesRegisterRow[]),
    gstSummary: (r) => read(() => gstSummary(r) as GstSummary),
  },

  dashboard: { summary: () => read(dashboard) },

  admin: {
    users: {
      list: () => read(() => [...db.users].sort((a, b) => a.name.localeCompare(b.name))),
      get: (id) => read(() => db.users.find((u) => u.id === id)),
      create: ({ password: _password, ...input }: UserInput) =>
        write(() => {
          if (db.users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) fail(`A user with email ${input.email} already exists`);
          const u: User = { id: nextId('usr'), lastLogin: null, ...input };
          db.users.push(u);
          audit('create', 'User', u.name, `Added user ${u.name} (${u.role})`);
          return u;
        }),
      update: (id, { password: _password, ...input }) =>
        write(() => {
          const u = must(db.users.find((x) => x.id === id), 'User');
          if (input.email && db.users.some((x) => x.id !== id && x.email.toLowerCase() === input.email!.toLowerCase())) fail(`A user with email ${input.email} already exists`);
          const next = { ...u, ...input };
          const admins = db.users.filter((x) => x.id !== id && x.role === 'admin' && x.active).length;
          if (admins === 0 && !(next.role === 'admin' && next.active)) fail('At least one active administrator is required');
          Object.assign(u, next);
          audit('update', 'User', u.name, `Updated user ${u.name}`);
          return u;
        }),
      remove: (id) =>
        write(() => {
          const u = must(db.users.find((x) => x.id === id), 'User');
          if (u.id === session.userId) fail('You cannot delete the account you are signed in with');
          if (u.role === 'admin' && db.users.filter((x) => x.role === 'admin' && x.active && x.id !== id).length === 0) fail('At least one active administrator is required');
          db.users = db.users.filter((x) => x.id !== id);
          audit('delete', 'User', u.name, `Deleted user ${u.name}`);
        }),
    },
    permissions: () => read(() => db.permissions),
    setPermission: (role: Role, module: ModuleKey, level: PermissionLevel) =>
      write(() => {
        if (role === 'admin' && module === 'admin' && level !== 'edit') fail('Administrators must keep full access to Administration');
        db.permissions[role][module] = level;
        audit('update', 'Permissions', role, `Set ${role} access to ${module}: ${level}`);
        return db.permissions;
      }),
    audit: () => read(() => db.audit),
    settings: () => read(() => db.settings),
    updateSettings: (input) =>
      write(() => {
        if (!input.companyName.trim()) fail('Company name is required');
        db.settings = { ...input };
        audit('update', 'Settings', 'Company settings', 'Updated company and billing settings');
        return db.settings;
      }),
    backups: () => read(() => [...db.backups].sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`))),
    runBackup: () =>
      write(() => {
        const rec = { id: nextId('bak'), date: today(), time: new Date().toTimeString().slice(0, 5), type: 'manual' as const, sizeMb: round2(40 + Math.random()), status: 'completed' as const };
        db.backups.push(rec);
        audit('other', 'Backup', rec.id, `Simulated backup started by ${actorName()}`);
        return rec;
      }),
  },
};
