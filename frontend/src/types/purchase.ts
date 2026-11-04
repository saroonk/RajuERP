import type { ID, ISODate, PaymentMode, StockBucket } from './common';

export interface POLine {
  productId: ID;
  qty: number;
  rate: number;
  gstRate: number;
}

export type POStatus = 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled';

export interface PurchaseOrder {
  id: ID;
  poNo: string;
  supplierId: ID;
  date: ISODate;
  expectedDate: ISODate | null;
  status: POStatus;
  lines: POLine[];
  notes: string;
}

export interface PurchaseOrderRow extends PurchaseOrder {
  supplierName: string;
  taxable: number;
  tax: number;
  total: number;
  /** Per product: ordered, received so far and still pending. */
  lineProgress: { productId: ID; ordered: number; received: number; pending: number }[];
  receivedPct: number;
}

export interface GRNLine {
  productId: ID;
  batchId: ID;
  batchNo: string;
  mfgDate: ISODate;
  expiryDate: ISODate;
  qty: number;
  rate: number;
  gstRate: number;
}

export interface GoodsReceipt {
  id: ID;
  grnNo: string;
  poId: ID;
  supplierId: ID;
  date: ISODate;
  supplierInvoiceNo: string;
  lines: GRNLine[];
  taxable: number;
  tax: number;
  total: number;
}

export interface GoodsReceiptRow extends GoodsReceipt {
  supplierName: string;
  poNo: string;
}

export interface SupplierReturnLine {
  batchId: ID;
  productId: ID;
  bucket: StockBucket;
  qty: number;
  rate: number;
  gstRate: number;
}

export interface SupplierReturn {
  id: ID;
  returnNo: string;
  supplierId: ID;
  date: ISODate;
  reason: string;
  lines: SupplierReturnLine[];
  taxable: number;
  tax: number;
  total: number;
}

export interface SupplierReturnRow extends SupplierReturn {
  supplierName: string;
}

export interface SupplierPayment {
  id: ID;
  paymentNo: string;
  supplierId: ID;
  date: ISODate;
  amount: number;
  mode: PaymentMode;
  reference: string;
  notes: string;
}

export interface SupplierPaymentRow extends SupplierPayment {
  supplierName: string;
}

export interface SupplierOutstanding {
  supplierId: ID;
  supplierName: string;
  gstin: string;
  purchases: number;
  returns: number;
  paid: number;
  outstanding: number;
  lastPaymentDate: ISODate | null;
}
