/**
 * Builds the demo dataset by replaying ~5 months of realistic activity through the same business
 * operations the UI uses (receipts, dispatches, invoices, payments, returns, ...). Because nothing is
 * hand-written into stock or balance tables, every report and dashboard figure stays consistent.
 * All names, GSTINs and contact details are fictitious.
 */
import type { DistributionOrder, Dispatch, GoodsReceipt, ID, ISODate, Invoice, PaymentMode, Product, Role, RolePermissions } from '@/types';
import { addDays, monthKey, round2, today } from '@/utils/format';
import { ServiceError } from '../types';
import { audit, db, nextDocNo, nextId, session, touch } from './db';
import {
  approveReconciliation,
  createDispatch,
  createInvoiceFromDispatch,
  createNote,
  createOrder,
  createPayment,
  createPO,
  createReconciliation,
  createSalesReturn,
  createSupplierPayment,
  createSupplierReturn,
  createWriteOff,
  reclassifyReturnLine,
  returnableLines,
  receiveGoods,
  setOrderStatus,
  suggestAllocation,
} from './ops';
import { batchStockRows, invoiceRowById, orderRow } from './selectors';

export const seedWarnings: string[] = [];

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const USERS = {
  admin: 'usr-0001',
  accounts: 'usr-0002',
  warehouse: 'usr-0003',
  sales: 'usr-0004',
};

function permissions(): RolePermissions {
  const all = (level: 'none' | 'view' | 'edit') => ({
    dashboard: level, products: level, inventory: level, purchases: level, distributors: level, distribution: level,
    sales: level, receivables: level, payables: level, expenses: level, reports: level, admin: level,
  });
  const p = (base: 'none' | 'view', edit: string[], view: string[] = []) => {
    const o: Record<string, string> = { ...all(base) };
    for (const k of view) o[k] = 'view';
    for (const k of edit) o[k] = 'edit';
    return o as RolePermissions[Role];
  };
  return {
    admin: all('edit'),
    accounts: p('none', ['sales', 'receivables', 'payables', 'expenses'], ['dashboard', 'products', 'inventory', 'purchases', 'distributors', 'distribution', 'reports']),
    warehouse: p('none', ['inventory', 'purchases', 'distribution'], ['dashboard', 'products', 'distributors', 'sales', 'reports']),
    sales: p('none', ['distributors', 'distribution', 'sales'], ['dashboard', 'products', 'inventory', 'receivables', 'reports']),
  };
}

export function seedDb(): void {
  const T = today();
  const r = rng(20260615);
  const randInt = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const pick = <X,>(arr: X[]): X => arr[Math.floor(r() * arr.length)];

  /* ------------------------------ masters ------------------------------ */
  Object.assign(db, {
    brands: [], categories: [], units: [], unitConversions: [], products: [], suppliers: [], distributors: [],
    distributorPrices: [], batches: [], movements: [], writeOffs: [], reconciliations: [], purchaseOrders: [],
    goodsReceipts: [], supplierReturns: [], supplierPayments: [], orders: [], dispatches: [], invoices: [],
    notes: [], salesReturns: [], stockReports: [], payments: [], expenses: [], expenseCategories: [], audit: [],
    backups: [],
  });
  seedWarnings.length = 0;

  db.settings = {
    companyName: 'Raju Distributors Pvt Ltd',
    gstin: '29AABCR4521F1Z5',
    state: 'Karnataka',
    address: '14, Industrial Layout, Peenya, Bengaluru 560058',
    phone: '+91 80 4000 1234',
    email: 'accounts@rajuerp.demo',
    valuationMethod: 'fifo',
    expiryAlertDays: 90,
    defaultCreditDays: 30,
    invoiceTerms: 'Goods once sold will not be taken back except for expiry or damage, subject to prior approval. Payment due as per credit terms.',
  };
  db.permissions = permissions();
  db.users = [
    { id: USERS.admin, name: 'Raju Krishnan', email: 'raju@rajuerp.demo', role: 'admin', active: true, lastLogin: new Date().toISOString() },
    { id: USERS.accounts, name: 'Anitha Shetty', email: 'anitha@rajuerp.demo', role: 'accounts', active: true, lastLogin: null },
    { id: USERS.warehouse, name: 'Mahesh Rao', email: 'mahesh@rajuerp.demo', role: 'warehouse', active: true, lastLogin: null },
    { id: USERS.sales, name: 'Suresh Naik', email: 'suresh@rajuerp.demo', role: 'sales', active: true, lastLogin: null },
    { id: 'usr-0005', name: 'Divya Menon', email: 'divya@rajuerp.demo', role: 'accounts', active: true, lastLogin: null },
    { id: 'usr-0006', name: 'Kiran Bhat', email: 'kiran@rajuerp.demo', role: 'warehouse', active: false, lastLogin: null },
  ];
  for (let i = 0; i < db.users.length; i++) nextId('usr'); // keep generated ids clear of the fixed ones

  db.units = [
    { id: 'unit-pcs', name: 'Pieces', code: 'Pcs' },
    { id: 'unit-box', name: 'Box', code: 'Box' },
    { id: 'unit-ctn', name: 'Carton', code: 'Ctn' },
    { id: 'unit-case', name: 'Case', code: 'Case' },
    { id: 'unit-kg', name: 'Kilogram', code: 'Kg' },
    { id: 'unit-ltr', name: 'Litre', code: 'Ltr' },
  ];
  db.unitConversions = [
    { id: 'conv-1', fromUnitId: 'unit-box', toUnitId: 'unit-pcs', factor: 12 },
    { id: 'conv-2', fromUnitId: 'unit-ctn', toUnitId: 'unit-box', factor: 4 },
    { id: 'conv-3', fromUnitId: 'unit-case', toUnitId: 'unit-pcs', factor: 24 },
    { id: 'conv-4', fromUnitId: 'unit-ctn', toUnitId: 'unit-pcs', factor: 48 },
  ];

  db.brands = [
    { id: 'brd-raju', name: "Raju's Choice", type: 'own', active: true, notes: 'Packaged foods, company-owned' },
    { id: 'brd-naturals', name: 'Sri Raju Naturals', type: 'own', active: true, notes: 'Personal care, company-owned' },
    { id: 'brd-kaveri', name: 'Kaveri Foods', type: 'external', active: true },
    { id: 'brd-sunrise', name: 'Sunrise Beverages', type: 'external', active: true },
    { id: 'brd-freshleaf', name: 'FreshLeaf Home Care', type: 'external', active: true },
    { id: 'brd-aarogya', name: 'Aarogya Wellness', type: 'external', active: true },
  ];

  const cat = (id: string, name: string, parentId: string | null = null) => db.categories.push({ id, name, parentId, active: true });
  cat('cat-bev', 'Beverages'); cat('sub-tea', 'Tea & Coffee', 'cat-bev'); cat('sub-juice', 'Juices & Water', 'cat-bev');
  cat('cat-snk', 'Snacks & Biscuits'); cat('sub-bis', 'Biscuits', 'cat-snk'); cat('sub-nam', 'Namkeen', 'cat-snk');
  cat('cat-stp', 'Staples'); cat('sub-rice', 'Rice & Flour', 'cat-stp'); cat('sub-oil', 'Edible Oil', 'cat-stp'); cat('sub-well', 'Wellness Foods', 'cat-stp');
  cat('cat-pc', 'Personal Care'); cat('sub-soap', 'Soaps', 'cat-pc'); cat('sub-hair', 'Hair Care', 'cat-pc');
  cat('cat-hc', 'Home Care'); cat('sub-det', 'Detergents & Cleaners', 'cat-hc');

  // sku, name, brand, category, subcategory, packUnit, packSize, purchase, sell, gst, minStock, shelfLifeDays, hsn
  type Row = [string, string, string, string, string, string, number, number, number, number, number, number, string];
  const rows: Row[] = [
    ['RC-TEA-250', "Raju's Choice Tea 250g", 'brd-raju', 'cat-bev', 'sub-tea', 'unit-box', 24, 78, 92, 5, 200, 540, '0902'],
    ['RC-COF-100', 'Filter Coffee Powder 100g', 'brd-raju', 'cat-bev', 'sub-tea', 'unit-box', 24, 62, 74, 5, 150, 365, '0901'],
    ['RC-RICE-5K', 'Sona Masuri Rice 5kg', 'brd-raju', 'cat-stp', 'sub-rice', 'unit-ctn', 4, 285, 320, 5, 100, 365, '1006'],
    ['RC-ATTA-5K', 'Whole Wheat Atta 5kg', 'brd-raju', 'cat-stp', 'sub-rice', 'unit-ctn', 4, 195, 222, 5, 100, 120, '1101'],
    ['RC-OIL-1L', 'Groundnut Oil 1L', 'brd-raju', 'cat-stp', 'sub-oil', 'unit-box', 12, 165, 188, 5, 150, 270, '1508'],
    ['RN-SOAP-100', 'Neem Soap 100g', 'brd-naturals', 'cat-pc', 'sub-soap', 'unit-box', 12, 18, 24, 18, 400, 730, '3401'],
    ['RN-SOAP-SND', 'Sandal Soap 100g', 'brd-naturals', 'cat-pc', 'sub-soap', 'unit-box', 12, 24, 32, 18, 300, 730, '3401'],
    ['RN-SHMP-180', 'Herbal Shampoo 180ml', 'brd-naturals', 'cat-pc', 'sub-hair', 'unit-box', 12, 72, 95, 18, 200, 730, '3305'],
    ['RN-HOIL-200', 'Coconut Hair Oil 200ml', 'brd-naturals', 'cat-pc', 'sub-hair', 'unit-box', 12, 64, 85, 18, 200, 730, '3305'],
    ['KF-BIS-MAR', 'Marie Biscuits 100g', 'brd-kaveri', 'cat-snk', 'sub-bis', 'unit-case', 48, 8, 10.5, 18, 600, 180, '1905'],
    ['KF-BIS-CRM', 'Cream Biscuits 75g', 'brd-kaveri', 'cat-snk', 'sub-bis', 'unit-case', 48, 9, 12, 18, 500, 150, '1905'],
    ['KF-NAM-MIX', 'Mixture Namkeen 200g', 'brd-kaveri', 'cat-snk', 'sub-nam', 'unit-case', 24, 32, 42, 12, 250, 120, '2106'],
    ['KF-NAM-BHJ', 'Aloo Bhujia 400g', 'brd-kaveri', 'cat-snk', 'sub-nam', 'unit-case', 24, 58, 76, 12, 200, 120, '2106'],
    ['KF-RUSK-200', 'Wheat Rusk 200g', 'brd-kaveri', 'cat-snk', 'sub-bis', 'unit-case', 24, 28, 38, 18, 150, 120, '1905'],
    ['SB-JUC-1L', 'Mango Juice 1L', 'brd-sunrise', 'cat-bev', 'sub-juice', 'unit-box', 12, 58, 78, 12, 200, 180, '2009'],
    ['SB-JUC-200', 'Mixed Fruit Juice 200ml', 'brd-sunrise', 'cat-bev', 'sub-juice', 'unit-case', 24, 12, 17, 12, 400, 150, '2009'],
    ['SB-ICT-250', 'Lemon Iced Tea 250ml', 'brd-sunrise', 'cat-bev', 'sub-tea', 'unit-case', 24, 18, 25, 12, 300, 180, '2202'],
    ['SB-WTR-1L', 'Packaged Drinking Water 1L', 'brd-sunrise', 'cat-bev', 'sub-juice', 'unit-box', 12, 12, 18, 18, 500, 365, '2201'],
    ['FL-DET-1K', 'Detergent Powder 1kg', 'brd-freshleaf', 'cat-hc', 'sub-det', 'unit-box', 10, 82, 108, 18, 200, 730, '3402'],
    ['FL-DISH-500', 'Dishwash Liquid 500ml', 'brd-freshleaf', 'cat-hc', 'sub-det', 'unit-box', 12, 64, 88, 18, 200, 730, '3402'],
    ['FL-FLR-1L', 'Floor Cleaner 1L', 'brd-freshleaf', 'cat-hc', 'sub-det', 'unit-box', 12, 92, 125, 18, 150, 730, '3402'],
    ['AW-HNY-500', 'Pure Honey 500g', 'brd-aarogya', 'cat-stp', 'sub-well', 'unit-box', 12, 210, 285, 12, 100, 540, '0409'],
    ['AW-CHY-500', 'Chyawanprash 500g', 'brd-aarogya', 'cat-stp', 'sub-well', 'unit-box', 12, 175, 240, 12, 80, 540, '2106'],
    ['AW-TULS-30', 'Tulsi Drops 30ml', 'brd-aarogya', 'cat-pc', 'sub-well', 'unit-box', 24, 72, 110, 12, 60, 540, '3004'],
  ];
  const shelf = new Map<string, number>();
  rows.forEach((x, i) => {
    const p: Product = {
      id: `prd-${String(i + 1).padStart(3, '0')}`,
      sku: x[0], name: x[1], brandId: x[2], categoryId: x[3], subcategoryId: x[4], unitId: 'unit-pcs', packUnitId: x[5],
      packSize: x[6], purchasePrice: x[7], sellingPrice: x[8], gstRate: x[9], minStock: x[10], hsnCode: x[12], active: true,
    };
    shelf.set(p.id, x[11]);
    db.products.push(p);
  });
  // 'AW-TULS-30' is categorised under Staples > Wellness; keep category consistent with its subcategory.
  db.products.find((p) => p.sku === 'AW-TULS-30')!.categoryId = 'cat-stp';

  const sup = (n: number, name: string, person: string, city: string, state: string, gstin: string) =>
    db.suppliers.push({ id: `sup-${String(n).padStart(3, '0')}`, name, contactPerson: person, phone: `+91 98${randInt(10000000, 99999999)}`, email: `sales@${name.toLowerCase().replace(/[^a-z]+/g, '').slice(0, 14)}.demo`, gstin, address: `${randInt(1, 90)}, Industrial Estate`, city, state, active: true });
  sup(1, 'Raju Agro Mills Pvt Ltd', 'Venkatesh Gowda', 'Mysuru', 'Karnataka', '29AACCR7781K1Z2');
  sup(2, 'Naturals Manufacturing Co', 'Lakshmi Narayanan', 'Coimbatore', 'Tamil Nadu', '33AAECN2210L1Z8');
  sup(3, 'Kaveri Foods Ltd', 'Prakash Hegde', 'Bengaluru', 'Karnataka', '29AABCK5532M1Z4');
  sup(4, 'Sunrise Beverages Pvt Ltd', 'Imran Sheikh', 'Hyderabad', 'Telangana', '36AAFCS9087Q1ZB');
  sup(5, 'FreshLeaf Home Care LLP', 'Neha Kulkarni', 'Pune', 'Maharashtra', '27AAHFF3345P1Z6');
  sup(6, 'Aarogya Wellness Products', 'Dr. Thomas Joseph', 'Kochi', 'Kerala', '32AAICA6612R1Z9');
  const supplierOfBrand: Record<string, ID> = { 'brd-raju': 'sup-001', 'brd-naturals': 'sup-002', 'brd-kaveri': 'sup-003', 'brd-sunrise': 'sup-004', 'brd-freshleaf': 'sup-005', 'brd-aarogya': 'sup-006' };

  type DRow = [string, 'distributor' | 'dealer', string, string, string, number, number, string, number, number];
  // name, type, person, city, state, limit, creditDays, gstin, payFull%, delay
  const drows: DRow[] = [
    ['Sri Venkateshwara Distributors', 'distributor', 'S. Venkatesh', 'Bengaluru', 'Karnataka', 800000, 30, '29AAGFS1201D1Z3', 0.9, 5],
    ['Mysore Fresh Traders', 'distributor', 'K. Ramesh', 'Mysuru', 'Karnataka', 600000, 30, '29AAKFM4410E1Z7', 0.85, 8],
    ['Hubli Sri Traders', 'distributor', 'B. Patil', 'Hubballi', 'Karnataka', 60000, 21, '29AADFH7733B1Z1', 0.3, 20],
    ['Chennai Metro Distributors', 'distributor', 'R. Subramanian', 'Chennai', 'Tamil Nadu', 700000, 30, '33AAJFC5566G1Z5', 0.6, 22],
    ['Coimbatore Bharat Agencies', 'dealer', 'M. Kannan', 'Coimbatore', 'Tamil Nadu', 30000, 15, '33AAHFB2290H1Z9', 0.95, 2],
    ['Kochi Coastal Distributors', 'distributor', 'T. George', 'Kochi', 'Kerala', 500000, 30, '32AAFFK8812J1Z6', 0.55, 12],
    ['Hyderabad Deccan Traders', 'distributor', 'A. Reddy', 'Hyderabad', 'Telangana', 800000, 45, '36AAEFH3345K1Z0', 0.9, 6],
    ['Pune Sahyadri Agencies', 'dealer', 'V. Joshi', 'Pune', 'Maharashtra', 80000, 15, '27AAGFP9981L1Z2', 0.35, 25],
    ['Mangaluru Sea Breeze Stores', 'dealer', 'D. Shetty', 'Mangaluru', 'Karnataka', 120000, 15, '29AAIFM6624N1Z8', 0.95, 3],
    ['Vijayawada Krishna Distributors', 'distributor', 'P. Rao', 'Vijayawada', 'Andhra Pradesh', 400000, 30, '37AAHFV1178P1Z4', 0.7, 18],
  ];
  const behaviour = new Map<ID, { full: number; delay: number }>();
  drows.forEach((x, i) => {
    const id = `dst-${String(i + 1).padStart(3, '0')}`;
    db.distributors.push({
      id, code: `D${String(i + 1).padStart(3, '0')}`, name: x[0], type: x[1], contactPerson: x[2], phone: `+91 97${randInt(10000000, 99999999)}`,
      email: `${x[0].toLowerCase().replace(/[^a-z]+/g, '.').slice(0, 20)}@mail.demo`, gstin: x[7], address: `${randInt(1, 120)}, Main Road`, city: x[3], state: x[4],
      creditLimit: x[5], creditDays: x[6], paymentTerms: x[6] <= 15 ? `Net ${x[6]} days` : `Net ${x[6]} days, ${x[1] === 'dealer' ? 'no cash discount' : '1% cash discount within 7 days'}`, active: true,
    });
    behaviour.set(id, { full: x[8], delay: x[9] });
  });
  // Distributor-specific commercial terms for the three largest accounts.
  for (const dId of ['dst-001', 'dst-004', 'dst-007']) {
    for (const p of db.products.filter((_, i) => i % 3 === (dId === 'dst-001' ? 0 : dId === 'dst-004' ? 1 : 2))) {
      const disc = pick([2, 3, 4, 5]);
      db.distributorPrices.push({ id: nextId('dpr'), distributorId: dId, productId: p.id, price: p.sellingPrice, discountPct: disc, terms: `${disc}% trade discount` });
    }
  }

  db.expenseCategories = ['Rent', 'Salaries', 'Utilities', 'Freight & Transport', 'Fuel', 'Warehouse Maintenance', 'Marketing', 'Office & Communication', 'Miscellaneous'].map((name, i) => ({ id: `exc-${String(i + 1).padStart(3, '0')}`, name }));

  /* ------------------------------ timeline ------------------------------ */
  type Ev = { date: ISODate; seq: number; as: string; run: () => void };
  const events: Ev[] = [];
  const at = (date: ISODate, as: string, run: () => void) => events.push({ date, seq: events.length, as, run });

  // Purchases
  const supplierIds = db.suppliers.map((s) => s.id);
  const lowStockSkus = new Set(['FL-FLR-1L', 'AW-HNY-500', 'RC-OIL-1L']);
  const grnOf = new Map<string, GoodsReceipt>();
  const poRefs = new Map<string, ID>();
  supplierIds.forEach((sid, si) => {
    const offsets = [-148, -108, -68, -30, -12];
    const prods = db.products.filter((p) => supplierOfBrand[p.brandId] === sid);
    offsets.forEach((off, k) => {
      const last = k === offsets.length - 1;
      const poDate = addDays(T, off + si);
      if (poDate >= T) return;
      const status: 'draft' | 'ordered' = last && si === 4 ? 'draft' : 'ordered';
      const key = `${sid}:${k}`;
      const lines = prods
        .filter((p) => !(lowStockSkus.has(p.sku) && k >= 3))
        .map((p) => {
          const base = lowStockSkus.has(p.sku) ? randInt(140, 200) : randInt(380, 640);
          const qty = Math.max(p.packSize, Math.round(base / p.packSize) * p.packSize);
          return { productId: p.id, qty, rate: p.purchasePrice, gstRate: p.gstRate };
        });
      at(poDate, USERS.admin, () => {
        const po = createPO({ supplierId: sid, date: poDate, expectedDate: addDays(poDate, 7), lines, notes: '', status });
        poRefs.set(key, po.id);
      });
      const grnDate = addDays(poDate, randInt(4, 6));
      const receivable = status === 'ordered' && !(last && si === 3) && grnDate <= T;
      if (!receivable) return;
      const partial = last && si === 5;
      at(grnDate, USERS.warehouse, () => {
        const po = db.purchaseOrders.find((x) => x.id === poRefs.get(key))!;
        const grn = receiveGoods({
          poId: po.id,
          date: grnDate,
          supplierInvoiceNo: `SI/${randInt(1000, 9999)}`,
          lines: po.lines.map((l) => {
            const p = db.products.find((x) => x.id === l.productId)!;
            const mfg = addDays(grnDate, -randInt(4, 20));
            const qty = partial ? Math.max(p.packSize, Math.round((l.qty * 0.6) / p.packSize) * p.packSize) : l.qty;
            return { productId: l.productId, batchNo: `${p.sku.split('-')[1]}-${grnDate.slice(2, 4)}${grnDate.slice(5, 7)}${grnDate.slice(8, 10)}`, mfgDate: mfg, expiryDate: addDays(mfg, shelf.get(p.id)!), qty };
          }),
        });
        grnOf.set(key, grn);
      });
      // Pay the supplier roughly a month after receipt (mostly in full).
      const payDate = addDays(grnDate, randInt(26, 36));
      if (payDate < T && !partial) {
        at(payDate, USERS.accounts, () => {
          const grn = grnOf.get(key);
          if (!grn) return;
          const amount = k % 3 === 2 ? round2(grn.total * 0.5) : grn.total;
          createSupplierPayment({ supplierId: sid, date: payDate, amount, mode: pick<PaymentMode>(['bank_transfer', 'bank_transfer', 'cheque', 'upi']), reference: `UTR${randInt(100000, 999999)}`, notes: '' });
        });
      }
    });
  });

  // Orders, dispatches, invoices, payments
  const dispatchLog: { invoice?: Invoice; dispatch?: Dispatch; date: ISODate; distributorId: ID }[] = [];
  const activeProducts = db.products;
  db.distributors.forEach((d, di) => {
    const beh = behaviour.get(d.id)!;
    let date = addDays(T, -133 + randInt(0, 8));
    while (date <= addDays(T, -2)) {
      const orderDate = date;
      const chosen = [...activeProducts].sort(() => r() - 0.5).slice(0, randInt(3, 6));
      const lines = chosen.map((p) => {
        const sp = db.distributorPrices.find((x) => x.distributorId === d.id && x.productId === p.id);
        const big = p.packSize >= 24 ? randInt(1, 4) : randInt(1, 6);
        return { productId: p.id, qty: Math.min(288, p.packSize * big), rate: p.sellingPrice, discountPct: sp?.discountPct ?? 0, gstRate: p.gstRate };
      });
      const recent = orderDate > addDays(T, -6);
      const holder: { order?: DistributionOrder } = {};
      const asDraft = recent && r() < 0.2;
      at(orderDate, USERS.sales, () => {
        holder.order = createOrder({ distributorId: d.id, date: orderDate, expectedDate: addDays(orderDate, 3), lines, notes: '', status: asDraft ? 'draft' : 'confirmed' });
      });
      const dispatchNow = !recent || r() < 0.4;
      if (!asDraft && dispatchNow) {
        const partialFirst = r() < 0.1;
        const plan = (dDate: ISODate, fraction: number, invoice: boolean) => {
          if (dDate > T) return;
          const log: (typeof dispatchLog)[number] = { date: dDate, distributorId: d.id };
          dispatchLog.push(log);
          at(dDate, USERS.warehouse, () => {
            const order = holder.order!;
            const progress = orderRow(order).lineProgress;
            const dlines: { productId: ID; batchId: ID; qty: number }[] = [];
            for (const p of progress) {
              const prod = db.products.find((x) => x.id === p.productId)!;
              let want = fraction >= 1 ? p.pending : Math.max(prod.packSize, Math.floor((p.pending * fraction) / prod.packSize) * prod.packSize);
              want = Math.min(want, p.pending);
              if (want <= 0) continue;
              for (const a of suggestAllocation(p.productId, want, dDate, Object.fromEntries(dlines.map((x) => [x.batchId, x.qty])))) dlines.push({ productId: p.productId, batchId: a.batchId, qty: a.qty });
            }
            if (!dlines.length) return;
            const disp = createDispatch({ orderId: order.id, date: dDate, vehicleNo: `KA-0${randInt(1, 9)}-${pick(['AB', 'CD', 'EF', 'MN'])}-${randInt(1000, 9999)}`, deliveryRef: `DC-${randInt(10000, 99999)}`, notes: '', lines: dlines });
            log.dispatch = disp;
            if (invoice) {
              session.userId = USERS.accounts;
              log.invoice = createInvoiceFromDispatch(disp.id, dDate);
            }
          });
          if (!invoice) return;
          const payDate = addDays(dDate, d.creditDays + randInt(Math.min(0, beh.delay - 6), beh.delay));
          if (payDate >= T) return;
          const roll = r();
          if (roll > beh.full + (1 - beh.full) * 0.5) return; // leaves some invoices unpaid
          at(payDate, USERS.accounts, () => {
            if (!log.invoice) return;
            const inv = invoiceRowById(log.invoice.id)!;
            const outstanding = inv.outstanding;
            if (outstanding <= 0) return;
            const amount = roll <= beh.full ? outstanding : Math.max(500, Math.round((outstanding * (0.3 + r() * 0.4)) / 100) * 100);
            createPayment({
              distributorId: d.id, date: payDate, amount, mode: pick<PaymentMode>(['bank_transfer', 'bank_transfer', 'upi', 'cheque', 'cash']),
              reference: `REF${randInt(100000, 999999)}`, notes: roll <= beh.full ? '' : 'Part payment', allocations: [{ invoiceId: inv.id, amount }],
            });
          });
        };
        const d1 = addDays(orderDate, randInt(1, 2));
        const invoiceIt = !(orderDate > addDays(T, -4) && r() < 0.5); // some very recent dispatches await invoicing
        if (partialFirst) {
          plan(d1, 0.6, true);
          plan(addDays(d1, 4), 1, true);
        } else plan(d1, 1, invoiceIt);
      }
      date = addDays(date, randInt(9, 17) + (di % 3));
    }
  });

  // Returns, credit/debit notes
  const invoiceCandidates = () => dispatchLog.filter((l) => l.invoice && l.date <= addDays(T, -14));
  const returnPlans: { reason: 'expired' | 'near_expiry' | 'damaged' | 'quality_issue'; cls: 'expired' | 'saleable' | 'damaged' | 'inspection' }[] = [
    { reason: 'expired', cls: 'expired' }, { reason: 'damaged', cls: 'damaged' }, { reason: 'near_expiry', cls: 'saleable' },
    { reason: 'quality_issue', cls: 'inspection' }, { reason: 'quality_issue', cls: 'inspection' }, { reason: 'damaged', cls: 'damaged' }, { reason: 'expired', cls: 'expired' },
  ];
  returnPlans.forEach((plan, i) => {
    const rDate = addDays(T, -75 + i * 9);
    at(rDate, USERS.warehouse, () => {
      const pool = invoiceCandidates().filter((l) => l.invoice!.date < addDays(rDate, -5) && db.invoices.some((x) => x.id === l.invoice!.id));
      if (!pool.length) return;
      const inv = pool[randInt(0, pool.length - 1)].invoice!;
      const room = returnableLines(inv.id).find((x) => x.remaining >= 6);
      if (!room) return;
      const line = { productId: room.productId, batchId: room.batchId };
      const qty = Math.min(room.remaining, randInt(6, 24));
      const ret = createSalesReturn({ invoiceId: inv.id, date: rDate, reason: plan.reason, notes: '', issueCreditNote: i !== 4, lines: [{ productId: line.productId, batchId: line.batchId, qty, classification: plan.cls }] });
      if (i === 3) reclassifyReturnLine(ret.id, 0, 'damaged', 'Packaging leak confirmed on inspection', addDays(rDate, 5));
    });
  });
  at(addDays(T, -21), USERS.accounts, () => {
    const l = invoiceCandidates().find((x) => x.invoice);
    if (l?.invoice) createNote({ type: 'credit', distributorId: l.distributorId, invoiceId: l.invoice.id, date: addDays(T, -21), reason: 'Rate difference adjustment', taxable: 850, gstRate: 18 });
  });
  at(addDays(T, -12), USERS.accounts, () => {
    const l = invoiceCandidates().filter((x) => x.invoice)[3];
    if (l?.invoice) createNote({ type: 'debit', distributorId: l.distributorId, invoiceId: l.invoice.id, date: addDays(T, -12), reason: 'Freight recovery', taxable: 1200, gstRate: 18 });
  });

  // Write-off of long-expired stock, supplier return, reconciliations
  at(addDays(T, -18), USERS.warehouse, () => {
    const lines = batchStockRows().filter((b) => b.expiryDate < addDays(T, -30) && b.saleable > 0).map((b) => ({ batchId: b.id, bucket: 'saleable' as const, qty: b.saleable }));
    if (lines.length) createWriteOff({ date: addDays(T, -18), reason: 'Expired stock disposal', lines });
  });
  at(addDays(T, -40), USERS.warehouse, () => {
    const b = batchStockRows().find((x) => x.supplierId === 'sup-003' && x.saleable >= 40 && x.daysToExpiry > 0);
    if (b) createSupplierReturn({ supplierId: b.supplierId, date: addDays(T, -40), reason: 'Short shelf life on delivery', lines: [{ batchId: b.id, bucket: 'saleable', qty: 24 }] });
  });
  at(addDays(T, -35), USERS.warehouse, () => {
    const batches = batchStockRows().filter((b) => b.saleable > 60 && b.daysToExpiry > 0).slice(0, 6);
    const rec = createReconciliation({ date: addDays(T, -35), notes: 'Monthly cycle count', lines: batches.map((b, i) => ({ batchId: b.id, physicalQty: b.saleable + [0, -2, 1, 0, -5, 0][i] })) });
    approveReconciliation(rec.id);
  });
  at(addDays(T, -2), USERS.warehouse, () => {
    const batches = batchStockRows().filter((b) => b.saleable > 40 && b.daysToExpiry > 30).slice(6, 10);
    createReconciliation({ date: addDays(T, -2), notes: 'Spot check - fast moving items', lines: batches.map((b, i) => ({ batchId: b.id, physicalQty: Math.max(0, b.saleable - [3, 0, 12, 1][i]) })) });
  });

  // An unallocated advance from a reliable distributor
  at(addDays(T, -6), USERS.accounts, () => createPayment({ distributorId: 'dst-007', date: addDays(T, -6), amount: 50000, mode: 'bank_transfer', reference: 'UTR778812', notes: 'Advance, to be allocated', allocations: [] }));
  // A large rusk delivery that outlives its shelf life, so expired stock and write-off flows have data.
  at(addDays(T, -104), USERS.admin, () => {
    const p = db.products.find((x) => x.sku === 'KF-RUSK-200')!;
    const po = createPO({ supplierId: 'sup-003', date: addDays(T, -104), expectedDate: addDays(T, -99), notes: 'Festive stocking', status: 'ordered', lines: [{ productId: p.id, qty: 1200, rate: p.purchasePrice, gstRate: p.gstRate }] });
    session.userId = USERS.warehouse;
    receiveGoods({ poId: po.id, date: addDays(T, -99), supplierInvoiceNo: 'SI/7788', lines: [{ productId: p.id, batchNo: 'RUSK-FEST', mfgDate: addDays(T, -140), expiryDate: addDays(T, -20), qty: 1200 }] });
  });
  // Open orders waiting to be dispatched and one draft, so the dispatch workflow can be tried straight away.
  [['dst-001', 2], ['dst-004', 1], ['dst-007', 1], ['dst-002', 3]].forEach(([dId, daysAgo], idx) => {
    const date = addDays(T, -(daysAgo as number));
    at(date, USERS.sales, () => {
      const picks = db.products.filter((_, i) => (i + idx * 5) % 6 === 0).slice(0, 4);
      createOrder({ distributorId: dId as string, date, expectedDate: addDays(date, 3), notes: '', status: 'confirmed', lines: picks.map((p) => ({ productId: p.id, qty: p.packSize * 3, rate: p.sellingPrice, discountPct: 0, gstRate: p.gstRate })) });
    });
  });
  at(addDays(T, -1), USERS.warehouse, () => {
    // Dispatched yesterday but not yet invoiced.
    const order = [...db.orders].reverse().find((o) => o.distributorId === 'dst-001' && o.status === 'confirmed');
    if (!order) return;
    const lines = order.lines.flatMap((l) => suggestAllocation(l.productId, l.qty, addDays(T, -1)).map((a) => ({ productId: l.productId, batchId: a.batchId, qty: a.qty })));
    createDispatch({ orderId: order.id, date: addDays(T, -1), vehicleNo: 'KA-05-MN-4821', deliveryRef: 'DC-88231', notes: 'Invoice to follow', lines });
  });
  at(addDays(T, -1), USERS.sales, () => {
    const picks = db.products.slice(8, 11);
    createOrder({ distributorId: 'dst-009', date: addDays(T, -1), expectedDate: null, notes: 'Awaiting confirmation', status: 'draft', lines: picks.map((p) => ({ productId: p.id, qty: p.packSize * 2, rate: p.sellingPrice, discountPct: 0, gstRate: p.gstRate })) });
  });
  // An old order that was cancelled
  at(addDays(T, -40), USERS.sales, () => {
    const p = db.products[2];
    const o = createOrder({ distributorId: 'dst-006', date: addDays(T, -40), expectedDate: null, notes: 'Customer postponed', status: 'confirmed', lines: [{ productId: p.id, qty: 96, rate: p.sellingPrice, discountPct: 0, gstRate: p.gstRate }] });
    setOrderStatus(o.id, 'cancelled');
  });

  events.sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
  for (const e of events) {
    session.userId = e.as;
    try {
      e.run();
    } catch (err) {
      if (err instanceof ServiceError) seedWarnings.push(`${e.date}: ${err.message}`);
      else throw err;
    }
  }
  session.userId = USERS.admin;

  /* ----------------------- expenses & reported stock ----------------------- */
  const ec = (name: string) => db.expenseCategories.find((c) => c.name === name)!.id;
  const monthStarts = [4, 3, 2, 1, 0].map((m) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - m);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const addExpense = (date: ISODate, cat: string, payee: string, description: string, amount: number, mode: PaymentMode) => {
    if (date > T) return;
    db.expenses.push({ id: nextId('exp'), expenseNo: nextDocNo('expense', date), date, categoryId: ec(cat), payee, description, amount, mode });
  };
  for (const m of monthStarts) {
    addExpense(`${m}-01`, 'Rent', 'Peenya Warehousing Co', 'Warehouse rent', 45000, 'bank_transfer');
    addExpense(`${m}-03`, 'Salaries', 'Staff payroll', 'Monthly salaries', randInt(205000, 215000), 'bank_transfer');
    addExpense(`${m}-08`, 'Utilities', 'BESCOM', 'Electricity bill', randInt(17000, 24000), 'upi');
    addExpense(`${m}-10`, 'Freight & Transport', 'Sri Ganesh Transport', 'Outbound freight', randInt(22000, 41000), 'bank_transfer');
    addExpense(`${m}-17`, 'Freight & Transport', 'VRL Logistics', 'Inter-state freight', randInt(12000, 26000), 'bank_transfer');
    addExpense(`${m}-12`, 'Fuel', 'HP Petrol Pump', 'Delivery vehicle fuel', randInt(8000, 14000), 'cash');
    addExpense(`${m}-14`, 'Office & Communication', 'Airtel', 'Internet and phones', 3200, 'upi');
    addExpense(`${m}-20`, 'Warehouse Maintenance', pick(['Ravi Maintenance', 'Pest Control India', 'Safety First Services']), 'Maintenance and pest control', randInt(2500, 9500), 'cash');
    if (r() < 0.6) addExpense(`${m}-24`, 'Marketing', 'Signboard Studio', 'Dealer boards and flyers', randInt(6000, 18000), 'bank_transfer');
    if (r() < 0.5) addExpense(`${m}-26`, 'Miscellaneous', 'Various', 'Sundry expenses', randInt(1200, 4800), 'cash');
  }

  // Distributor-reported sales for the largest accounts (previous month), from what was dispatched to them.
  const prevPeriod = monthKey(addDays(`${monthKey(T)}-01`, -1));
  for (const dId of ['dst-001', 'dst-002', 'dst-004', 'dst-007']) {
    const dispatched = new Map<ID, number>();
    for (const disp of db.dispatches.filter((x) => x.distributorId === dId)) for (const l of disp.lines) dispatched.set(l.productId, (dispatched.get(l.productId) ?? 0) + l.qty);
    [...dispatched.entries()].slice(0, 6).forEach(([productId, qty]) => {
      db.stockReports.push({
        id: nextId('dsr'), distributorId: dId, productId, period: prevPeriod,
        reportedSales: Math.floor(qty * 0.72), remainingStock: Math.floor(qty * 0.2), returned: 0, reportedOn: addDays(`${monthKey(T)}-01`, 3 > Number(T.slice(8)) ? 0 : 3), source: 'import',
      });
    });
  }

  for (let i = 0; i < 6; i++) {
    const date = addDays(T, -i * 7 - 2);
    db.backups.push({ id: nextId('bak'), date, time: '02:00', type: 'scheduled', sizeMb: round2(38 + i * 0.4 + r()), status: i === 3 ? 'failed' : 'completed' });
  }
  audit('other', 'System', 'Seed', 'Demo data loaded');
  touch();
}
