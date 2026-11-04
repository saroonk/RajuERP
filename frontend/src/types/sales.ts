import type { ID, ISODate, PaymentMode } from './common';

export type OrderStatus = 'draft' | 'confirmed' | 'partially_dispatched' | 'dispatched' | 'cancelled';

export interface OrderLine {
  productId: ID;
  qty: number;
  /** Rate per base unit before discount. */
  rate: number;
  discountPct: number;
  gstRate: number;
}

export interface DistributionOrder {
  id: ID;
  orderNo: string;
  distributorId: ID;
  date: ISODate;
  expectedDate: ISODate | null;
  status: OrderStatus;
  lines: OrderLine[];
  notes: string;
}

export interface DistributionOrderRow extends DistributionOrder {
  distributorName: string;
  taxable: number;
  tax: number;
  total: number;
  lineProgress: { productId: ID; ordered: number; dispatched: number; pending: number }[];
  dispatchedPct: number;
  hasDispatches: boolean;
}

export interface DispatchLine {
  productId: ID;
  batchId: ID;
  qty: number;
}

export interface Dispatch {
  id: ID;
  dispatchNo: string;
  orderId: ID;
  distributorId: ID;
  date: ISODate;
  vehicleNo: string;
  deliveryRef: string;
  lines: DispatchLine[];
  invoiceId: ID | null;
  notes: string;
}

export interface DispatchRow extends Dispatch {
  orderNo: string;
  distributorName: string;
  invoiceNo: string | null;
  totalQty: number;
}

export interface InvoiceLine {
  productId: ID;
  batchId: ID;
  qty: number;
  rate: number;
  discountPct: number;
  gstRate: number;
  /** Cost per unit of the batch at the time of invoicing (for profitability). */
  unitCost: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface Invoice {
  id: ID;
  invoiceNo: string;
  distributorId: ID;
  orderId: ID;
  dispatchId: ID;
  date: ISODate;
  dueDate: ISODate;
  /** True when supplier and recipient states differ, so IGST applies instead of CGST+SGST. */
  interState: boolean;
  lines: InvoiceLine[];
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
}

export type InvoicePayStatus = 'unpaid' | 'partial' | 'paid';

export interface InvoiceRow extends Invoice {
  distributorName: string;
  distributorGstin: string;
  distributorState: string;
  orderNo: string;
  dispatchNo: string;
  paid: number;
  credited: number;
  debited: number;
  outstanding: number;
  payStatus: InvoicePayStatus;
  overdue: boolean;
  daysOverdue: number;
}

export interface NoteDocument {
  id: ID;
  noteNo: string;
  type: 'credit' | 'debit';
  distributorId: ID;
  invoiceId: ID | null;
  returnId: ID | null;
  date: ISODate;
  reason: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** Paise carried by the credit note that completes a full return, so credits equal the invoice's rounded total. */
  roundOff: number;
  total: number;
}

export interface NoteRow extends NoteDocument {
  distributorName: string;
  invoiceNo: string | null;
  returnNo: string | null;
}

export type ReturnClassification = 'saleable' | 'damaged' | 'expired' | 'inspection';
export type ReturnReason = 'expired' | 'near_expiry' | 'damaged' | 'wrong_item' | 'quality_issue' | 'other';

export interface SalesReturnLine {
  productId: ID;
  batchId: ID;
  qty: number;
  rate: number;
  discountPct: number;
  gstRate: number;
  unitCost: number;
  /** Current disposition; `inspection` lines are pending a decision. */
  classification: ReturnClassification;
  dispositionNote: string;
}

export interface SalesReturn {
  id: ID;
  returnNo: string;
  distributorId: ID;
  invoiceId: ID;
  date: ISODate;
  reason: ReturnReason;
  notes: string;
  lines: SalesReturnLine[];
  creditNoteId: ID | null;
}

export interface SalesReturnRow extends SalesReturn {
  distributorName: string;
  invoiceNo: string;
  totalQty: number;
  /** Taxable value of returned goods. */
  value: number;
  creditNoteNo: string | null;
  status: 'pending_inspection' | 'reconciled';
}

export interface DistributorStockReport {
  id: ID;
  distributorId: ID;
  productId: ID;
  /** `YYYY-MM` */
  period: string;
  reportedSales: number;
  remainingStock: number;
  returned: number;
  reportedOn: ISODate;
  source: 'manual' | 'import';
}

export interface DistributorStockReportRow extends DistributorStockReport {
  distributorName: string;
  productName: string;
  sku: string;
}

export interface DistributorStockRow {
  distributorId: ID;
  distributorName: string;
  productId: ID;
  productName: string;
  sku: string;
  dispatched: number;
  returnedToUs: number;
  /** Sum of distributor-reported sales; null when nothing has been reported. */
  reportedSales: number | null;
  reportedRemaining: number | null;
  lastPeriod: string | null;
  /** dispatched - returnedToUs - reportedSales - reportedRemaining. Null without reports. */
  unreconciled: number | null;
}

export interface Payment {
  id: ID;
  receiptNo: string;
  distributorId: ID;
  date: ISODate;
  amount: number;
  mode: PaymentMode;
  reference: string;
  notes: string;
  allocations: { invoiceId: ID; amount: number }[];
}

export interface PaymentRow extends Payment {
  distributorName: string;
  allocated: number;
  unallocated: number;
}

export interface DistributorBalance {
  distributorId: ID;
  distributorName: string;
  code: string;
  type: 'distributor' | 'dealer';
  creditLimit: number;
  invoiced: number;
  debitNotes: number;
  creditNotes: number;
  received: number;
  /** invoiced + debitNotes - creditNotes - received. */
  balance: number;
  /** Receipts not yet allocated to a specific invoice. */
  unallocated: number;
  overdueAmount: number;
  overdueInvoices: number;
  creditUsedPct: number;
  overLimit: boolean;
  lastPaymentDate: ISODate | null;
}

export interface LedgerEntry {
  date: ISODate;
  type: 'invoice' | 'payment' | 'credit_note' | 'debit_note';
  ref: string;
  refId: ID;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface AllocationSuggestion {
  invoiceId: ID;
  invoiceNo: string;
  date: ISODate;
  dueDate: ISODate;
  outstanding: number;
  suggested: number;
}

export interface BatchAllocation {
  batchId: ID;
  batchNo: string;
  expiryDate: ISODate;
  qty: number;
}
