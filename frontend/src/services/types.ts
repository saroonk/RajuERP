/**
 * Service contracts. Pages depend only on these interfaces (via `services` in ./index.ts).
 * The mock implementation lives in ./mock; a Django REST Framework client can implement the
 * same interfaces later without touching any UI code.
 */
import type {
  AlertSummary,
  AllocationSuggestion,
  AuditEntry,
  BackupRecord,
  Batch,
  BatchAllocation,
  BatchStock,
  Brand,
  BrandReportRow,
  Category,
  DashboardSummary,
  DateRange,
  DispatchLine,
  DispatchRow,
  DistributionOrderRow,
  Distributor,
  DistributorBalance,
  DistributorPerfRow,
  DistributorPrice,
  DistributorStockReport,
  DistributorStockReportRow,
  DistributorStockRow,
  Expense,
  ExpenseCategory,
  ExpenseRow,
  GoodsReceiptRow,
  GstSummary,
  ID,
  IncomeExpenseSummary,
  InvoiceRow,
  ISODate,
  LedgerEntry,
  ModuleKey,
  MovementRow,
  NoteRow,
  OrderLine,
  OrderStatus,
  PaymentMode,
  PaymentRow,
  PermissionLevel,
  POLine,
  POStatus,
  Product,
  ProductPerfRow,
  ProductStock,
  PurchaseOrderRow,
  PurchaseRegisterRow,
  Reconciliation,
  ReturnClassification,
  ReturnReason,
  Role,
  RolePermissions,
  SalesProfitReport,
  SalesRegisterRow,
  SalesReturnRow,
  SearchResult,
  Settings,
  StockBucket,
  Supplier,
  SupplierOutstanding,
  SupplierPaymentRow,
  SupplierReturnRow,
  Unit,
  UnitConversion,
  User,
  ValuationMethod,
  ValuationRow,
  WriteOff,
} from '@/types';

export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceError';
  }
}

export interface CrudService<T extends { id: ID }, TInput = Omit<T, 'id'>> {
  list(): Promise<T[]>;
  get(id: ID): Promise<T | undefined>;
  create(input: TInput): Promise<T>;
  update(id: ID, input: Partial<TInput>): Promise<T>;
  /** Rejects with a ServiceError when other records still reference this one. */
  remove(id: ID): Promise<void>;
}

/* ----------------------------- inputs ----------------------------- */

export interface POInput {
  supplierId: ID;
  date: ISODate;
  expectedDate: ISODate | null;
  lines: POLine[];
  notes: string;
  status: Extract<POStatus, 'draft' | 'ordered'>;
}

export interface GRNInput {
  poId: ID;
  date: ISODate;
  supplierInvoiceNo: string;
  lines: { productId: ID; batchNo: string; mfgDate: ISODate; expiryDate: ISODate; qty: number }[];
}

export interface SupplierReturnInput {
  supplierId: ID;
  date: ISODate;
  reason: string;
  lines: { batchId: ID; bucket: StockBucket; qty: number }[];
}

export interface SupplierPaymentInput {
  supplierId: ID;
  date: ISODate;
  amount: number;
  mode: PaymentMode;
  reference: string;
  notes: string;
}

export interface OrderInput {
  distributorId: ID;
  date: ISODate;
  expectedDate: ISODate | null;
  lines: OrderLine[];
  notes: string;
  status: Extract<OrderStatus, 'draft' | 'confirmed'>;
}

export interface DispatchInput {
  orderId: ID;
  date: ISODate;
  vehicleNo: string;
  deliveryRef: string;
  notes: string;
  lines: DispatchLine[];
}

export interface SalesReturnInput {
  invoiceId: ID;
  date: ISODate;
  reason: ReturnReason;
  notes: string;
  /** When true a credit note for the returned goods is issued together with the return. */
  issueCreditNote: boolean;
  lines: { productId: ID; batchId: ID; qty: number; classification: ReturnClassification }[];
}

export interface NoteInput {
  type: 'credit' | 'debit';
  distributorId: ID;
  invoiceId: ID | null;
  date: ISODate;
  reason: string;
  /** Amount before GST. */
  taxable: number;
  gstRate: number;
}

export interface PaymentInput {
  distributorId: ID;
  date: ISODate;
  amount: number;
  mode: PaymentMode;
  reference: string;
  notes: string;
  allocations: { invoiceId: ID; amount: number }[];
}

export interface WriteOffInput {
  date: ISODate;
  reason: string;
  lines: { batchId: ID; bucket: StockBucket; qty: number }[];
}

export interface ReconciliationInput {
  date: ISODate;
  notes: string;
  lines: { batchId: ID; physicalQty: number }[];
}

export type ExpenseInput = Omit<Expense, 'id' | 'expenseNo'>;
export type DistributorReportInput = Omit<DistributorStockReport, 'id' | 'reportedOn' | 'source'>;
export type UserInput = Omit<User, 'id' | 'lastLogin'> & {
  /** Required when creating a user; optional on update (blank keeps the current password). */
  password?: string;
};

export interface ImportResult {
  imported: number;
  errors: { row: number; message: string }[];
}

/* ---------------------------- services ---------------------------- */

export interface Lookups {
  brands: Brand[];
  categories: Category[];
  units: Unit[];
  products: Product[];
  suppliers: Supplier[];
  distributors: Distributor[];
  expenseCategories: ExpenseCategory[];
}

export interface InventoryService {
  /** One row per product with stock per bucket (centralized stock). */
  stockByProduct(): Promise<ProductStock[]>;
  /** One row per batch with derived stock per bucket and expiry status. */
  batchStock(): Promise<BatchStock[]>;
  movements(): Promise<MovementRow[]>;
  valuation(method: ValuationMethod): Promise<ValuationRow[]>;
  alerts(): Promise<AlertSummary>;
  writeOffs(): Promise<(WriteOff & { lineCount: number; totalQty: number })[]>;
  createWriteOff(input: WriteOffInput): Promise<WriteOff>;
  reconciliations(): Promise<(Reconciliation & { totalVariance: number })[]>;
  getReconciliation(id: ID): Promise<Reconciliation | undefined>;
  createReconciliation(input: ReconciliationInput): Promise<Reconciliation>;
  /** Posts adjustment movements for every counted difference. */
  approveReconciliation(id: ID): Promise<Reconciliation>;
  deleteReconciliation(id: ID): Promise<void>;
  /** Suggests batches (earliest expiry first) for a dispatch of `qty` of a product on `date`. */
  suggestAllocation(productId: ID, qty: number, date: ISODate, exclude?: Record<ID, number>): Promise<BatchAllocation[]>;
  /** Batches of a product that can currently be dispatched (saleable, unexpired on `date`). */
  dispatchableBatches(productId: ID, date: ISODate): Promise<BatchStock[]>;
  getBatch(id: ID): Promise<Batch | undefined>;
}

export interface PurchaseService {
  orders: {
    list(): Promise<PurchaseOrderRow[]>;
    get(id: ID): Promise<PurchaseOrderRow | undefined>;
    create(input: POInput): Promise<PurchaseOrderRow>;
    update(id: ID, input: POInput): Promise<PurchaseOrderRow>;
    setStatus(id: ID, status: Extract<POStatus, 'ordered' | 'cancelled'>): Promise<PurchaseOrderRow>;
    remove(id: ID): Promise<void>;
  };
  receipts: {
    list(): Promise<GoodsReceiptRow[]>;
    get(id: ID): Promise<GoodsReceiptRow | undefined>;
    /** Creates batches, posts receipt movements and updates the PO status. */
    create(input: GRNInput): Promise<GoodsReceiptRow>;
  };
  returns: {
    list(): Promise<SupplierReturnRow[]>;
    get(id: ID): Promise<SupplierReturnRow | undefined>;
    create(input: SupplierReturnInput): Promise<SupplierReturnRow>;
  };
  payments: {
    list(): Promise<SupplierPaymentRow[]>;
    create(input: SupplierPaymentInput): Promise<SupplierPaymentRow>;
  };
  outstanding(): Promise<SupplierOutstanding[]>;
}

export interface DistributionService {
  orders: {
    list(): Promise<DistributionOrderRow[]>;
    get(id: ID): Promise<DistributionOrderRow | undefined>;
    create(input: OrderInput): Promise<DistributionOrderRow>;
    /** Only allowed while the order has no dispatches. */
    update(id: ID, input: OrderInput): Promise<DistributionOrderRow>;
    confirm(id: ID): Promise<DistributionOrderRow>;
    cancel(id: ID): Promise<DistributionOrderRow>;
    remove(id: ID): Promise<void>;
  };
  dispatches: {
    list(): Promise<DispatchRow[]>;
    get(id: ID): Promise<DispatchRow | undefined>;
    /** Allocates batches, posts dispatch movements and updates the order status. */
    create(input: DispatchInput): Promise<DispatchRow>;
  };
  /** Dispatched vs distributor-reported sales and remaining stock. */
  stock(): Promise<DistributorStockRow[]>;
  stockReports(): Promise<DistributorStockReportRow[]>;
  addStockReport(input: DistributorReportInput): Promise<DistributorStockReport>;
  /** Rows: distributorCode, sku, period (YYYY-MM), reportedSales, remainingStock, returned. */
  importStockReports(rows: string[][]): Promise<ImportResult>;
  deleteStockReport(id: ID): Promise<void>;
}

export interface SalesService {
  invoices: {
    list(): Promise<InvoiceRow[]>;
    get(id: ID): Promise<InvoiceRow | undefined>;
    /** Dispatches that have no invoice yet. */
    uninvoicedDispatches(): Promise<DispatchRow[]>;
    createFromDispatch(dispatchId: ID, date: ISODate): Promise<InvoiceRow>;
  };
  notes: {
    list(): Promise<NoteRow[]>;
    create(input: NoteInput): Promise<NoteRow>;
  };
  returns: {
    list(): Promise<SalesReturnRow[]>;
    get(id: ID): Promise<SalesReturnRow | undefined>;
    /** Lines of an invoice that can still be returned, per product + batch. */
    returnableLines(invoiceId: ID): Promise<{ productId: ID; batchId: ID; batchNo: string; invoiced: number; returned: number; remaining: number }[]>;
    create(input: SalesReturnInput): Promise<SalesReturnRow>;
    /** Decides the disposition of a line that was received for inspection. */
    reclassify(returnId: ID, lineIndex: number, to: Exclude<ReturnClassification, 'inspection'>, note: string): Promise<SalesReturnRow>;
  };
}

export interface AccountsService {
  balances(): Promise<DistributorBalance[]>;
  ledger(distributorId: ID): Promise<LedgerEntry[]>;
  openInvoices(distributorId: ID): Promise<InvoiceRow[]>;
  /** Oldest-due-first allocation of `amount` across open invoices. */
  suggestAllocations(distributorId: ID, amount: number): Promise<AllocationSuggestion[]>;
  payments: {
    list(): Promise<PaymentRow[]>;
    get(id: ID): Promise<PaymentRow | undefined>;
    create(input: PaymentInput): Promise<PaymentRow>;
    /** Allocates part of an existing payment's unallocated amount to more invoices. */
    allocate(id: ID, allocations: { invoiceId: ID; amount: number }[]): Promise<PaymentRow>;
  };
  expenses: {
    list(): Promise<ExpenseRow[]>;
    create(input: ExpenseInput): Promise<ExpenseRow>;
    update(id: ID, input: ExpenseInput): Promise<ExpenseRow>;
    remove(id: ID): Promise<void>;
  };
  expenseCategories: CrudService<ExpenseCategory>;
  summary(range: DateRange): Promise<IncomeExpenseSummary>;
}

export interface ReportsService {
  salesProfitability(range: DateRange): Promise<SalesProfitReport>;
  brands(range: DateRange): Promise<BrandReportRow[]>;
  products(range: DateRange): Promise<ProductPerfRow[]>;
  distributors(range: DateRange): Promise<DistributorPerfRow[]>;
  purchaseRegister(range: DateRange): Promise<PurchaseRegisterRow[]>;
  salesRegister(range: DateRange): Promise<SalesRegisterRow[]>;
  gstSummary(range: DateRange): Promise<GstSummary>;
}

export interface AdminService {
  users: CrudService<User, UserInput>;
  permissions(): Promise<RolePermissions>;
  setPermission(role: Role, module: ModuleKey, level: PermissionLevel): Promise<RolePermissions>;
  audit(): Promise<AuditEntry[]>;
  settings(): Promise<Settings>;
  updateSettings(input: Settings): Promise<Settings>;
  backups(): Promise<BackupRecord[]>;
  /** Adds a simulated backup record; no data is actually exported. */
  runBackup(): Promise<BackupRecord>;
}

export interface Services {
  auth: {
    /** Mock authentication only: any non-empty password is accepted for an active user. */
    login(email: string, password: string): Promise<User>;
    logout(userId: ID): Promise<void>;
    getUser(id: ID): Promise<User | undefined>;
    /** Restores an existing session on page load (HTTP: the session cookie; mock: the remembered user). */
    restore(): Promise<User | undefined>;
    demoUsers(): Promise<User[]>;
  };
  lookups: { all(): Promise<Lookups> };
  search(query: string): Promise<SearchResult[]>;
  brands: CrudService<Brand>;
  categories: CrudService<Category>;
  units: CrudService<Unit>;
  unitConversions: CrudService<UnitConversion>;
  products: CrudService<Product>;
  suppliers: CrudService<Supplier>;
  distributors: CrudService<Distributor>;
  distributorPrices: CrudService<DistributorPrice>;
  inventory: InventoryService;
  purchases: PurchaseService;
  distribution: DistributionService;
  sales: SalesService;
  accounts: AccountsService;
  reports: ReportsService;
  dashboard: { summary(): Promise<DashboardSummary> };
  admin: AdminService;
}
