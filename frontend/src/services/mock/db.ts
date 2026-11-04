import type {
  AuditEntry,
  BackupRecord,
  Batch,
  Brand,
  Category,
  DistributionOrder,
  Dispatch,
  Distributor,
  DistributorPrice,
  DistributorStockReport,
  Expense,
  ExpenseCategory,
  GoodsReceipt,
  Invoice,
  NoteDocument,
  Payment,
  Product,
  PurchaseOrder,
  Reconciliation,
  RolePermissions,
  SalesReturn,
  Settings,
  StockMovement,
  Supplier,
  SupplierPayment,
  SupplierReturn,
  Unit,
  UnitConversion,
  User,
  WriteOff,
} from '@/types';
import { today } from '@/utils/format';
import { bumpData } from '../dataEvents';
import { ServiceError } from '../types';

/** The in-memory "database". All mock services read and write through this single object. */
export interface Db {
  brands: Brand[];
  categories: Category[];
  units: Unit[];
  unitConversions: UnitConversion[];
  products: Product[];
  suppliers: Supplier[];
  distributors: Distributor[];
  distributorPrices: DistributorPrice[];
  batches: Batch[];
  movements: StockMovement[];
  writeOffs: WriteOff[];
  reconciliations: Reconciliation[];
  purchaseOrders: PurchaseOrder[];
  goodsReceipts: GoodsReceipt[];
  supplierReturns: SupplierReturn[];
  supplierPayments: SupplierPayment[];
  orders: DistributionOrder[];
  dispatches: Dispatch[];
  invoices: Invoice[];
  notes: NoteDocument[];
  salesReturns: SalesReturn[];
  stockReports: DistributorStockReport[];
  payments: Payment[];
  expenses: Expense[];
  expenseCategories: ExpenseCategory[];
  users: User[];
  permissions: RolePermissions;
  audit: AuditEntry[];
  settings: Settings;
  backups: BackupRecord[];
}

export const db = {} as Db;

/** Signals that data changed so mounted pages refetch. Call after every mutation. */
export function touch(): void {
  bumpData();
}

const counters: Record<string, number> = {};
export function nextId(prefix: string): string {
  counters[prefix] = (counters[prefix] ?? 0) + 1;
  return `${prefix}-${String(counters[prefix]).padStart(4, '0')}`;
}

const DOC_PREFIX = {
  po: 'PO',
  grn: 'GRN',
  supplierReturn: 'SRT',
  supplierPayment: 'SPY',
  order: 'ORD',
  dispatch: 'DSP',
  invoice: 'INV',
  creditNote: 'CN',
  debitNote: 'DN',
  salesReturn: 'RET',
  receipt: 'RCT',
  writeOff: 'WO',
  reconciliation: 'REC',
  expense: 'EXP',
} as const;
export type DocKind = keyof typeof DOC_PREFIX;

/** Sequential document numbers per document kind and calendar year, e.g. `INV-2026-0012`. */
export function nextDocNo(kind: DocKind, date: string): string {
  const key = `doc:${kind}:${date.slice(0, 4)}`;
  counters[key] = (counters[key] ?? 0) + 1;
  return `${DOC_PREFIX[kind]}-${date.slice(0, 4)}-${String(counters[key]).padStart(4, '0')}`;
}

/** Acting user for audit entries and stock movements. */
export const session = { userId: 'usr-0001' };

export function actorName(): string {
  return db.users.find((u) => u.id === session.userId)?.name ?? 'System';
}

export function audit(
  action: AuditEntry['action'],
  entityType: string,
  entityRef: string,
  summary: string,
  date: string = today(),
): void {
  const at = date === today() ? new Date().toISOString() : `${date}T10:30:00.000Z`;
  db.audit.unshift({
    id: nextId('aud'),
    at,
    userId: session.userId,
    userName: actorName(),
    action,
    entityType,
    entityRef,
    summary,
  });
}

export function fail(message: string): never {
  throw new ServiceError(message);
}

export function must<T>(item: T | undefined, what: string): T {
  if (item === undefined) fail(`${what} not found`);
  return item;
}

/** Which collections hold references to each master record, used to block unsafe deletes. */
const REFERENCES: Record<string, { label: string; rows: () => object[]; field: string }[]> = {
  brands: [{ label: 'products', rows: () => db.products, field: 'brandId' }],
  categories: [
    { label: 'products', rows: () => db.products, field: 'categoryId' },
    { label: 'subcategories', rows: () => db.categories, field: 'parentId' },
    { label: 'subcategorised products', rows: () => db.products, field: 'subcategoryId' },
  ],
  units: [
    { label: 'products', rows: () => db.products, field: 'unitId' },
    { label: 'products (pack unit)', rows: () => db.products, field: 'packUnitId' },
    { label: 'unit conversions', rows: () => db.unitConversions, field: 'fromUnitId' },
    { label: 'unit conversions', rows: () => db.unitConversions, field: 'toUnitId' },
  ],
  products: [
    { label: 'batches', rows: () => db.batches, field: 'productId' },
    { label: 'distributor prices', rows: () => db.distributorPrices, field: 'productId' },
    { label: 'stock reports', rows: () => db.stockReports, field: 'productId' },
  ],
  suppliers: [
    { label: 'purchase orders', rows: () => db.purchaseOrders, field: 'supplierId' },
    { label: 'supplier payments', rows: () => db.supplierPayments, field: 'supplierId' },
  ],
  distributors: [
    { label: 'orders', rows: () => db.orders, field: 'distributorId' },
    { label: 'invoices', rows: () => db.invoices, field: 'distributorId' },
    { label: 'payments', rows: () => db.payments, field: 'distributorId' },
    { label: 'distributor prices', rows: () => db.distributorPrices, field: 'distributorId' },
  ],
  expenseCategories: [{ label: 'expenses', rows: () => db.expenses, field: 'categoryId' }],
};

export function ensureNotReferenced(collection: keyof typeof REFERENCES & string, id: string, name: string): void {
  for (const ref of REFERENCES[collection] ?? []) {
    const count = ref.rows().filter((r) => (r as Record<string, unknown>)[ref.field] === id).length;
    if (count > 0) {
      fail(`Cannot delete "${name}": it is used by ${count} ${ref.label}. Mark it inactive instead.`);
    }
  }
}
