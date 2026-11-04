import type { ID, ISODate, StockBucket } from './common';

export interface Batch {
  id: ID;
  productId: ID;
  batchNo: string;
  mfgDate: ISODate;
  expiryDate: ISODate;
  receivedQty: number;
  /** Cost per base unit (excl. GST). */
  costPrice: number;
  supplierId: ID;
  receiptId: ID;
  receivedOn: ISODate;
}

export type MovementType =
  | 'receipt'
  | 'dispatch'
  | 'sales_return'
  | 'supplier_return'
  | 'adjustment'
  | 'write_off'
  | 'reclassification';

/** Every stock change is one signed row here; batch quantities are always derived from it. */
export interface StockMovement {
  id: ID;
  date: ISODate;
  productId: ID;
  batchId: ID;
  type: MovementType;
  bucket: StockBucket;
  /** Signed, in base units. */
  qty: number;
  refType: string;
  refId: ID;
  refNo: string;
  note: string;
  createdBy: string;
}

export interface WriteOffLine {
  batchId: ID;
  productId: ID;
  bucket: StockBucket;
  qty: number;
  unitCost: number;
}

export interface WriteOff {
  id: ID;
  writeOffNo: string;
  date: ISODate;
  reason: string;
  lines: WriteOffLine[];
  totalValue: number;
}

export interface ReconciliationLine {
  batchId: ID;
  productId: ID;
  /** Saleable quantity recorded by the system when the count was entered. */
  systemQty: number;
  physicalQty: number;
  /** Adjustment actually posted on approval (physical - system quantity at approval time). */
  appliedDiff: number | null;
}

export interface Reconciliation {
  id: ID;
  refNo: string;
  date: ISODate;
  status: 'draft' | 'approved';
  notes: string;
  lines: ReconciliationLine[];
  approvedBy: string | null;
  approvedOn: ISODate | null;
}

export type ExpiryStatus = 'expired' | 'critical' | 'warning' | 'ok';

/** Batch with derived stock per bucket and expiry state. */
export interface BatchStock extends Batch {
  productName: string;
  sku: string;
  brandId: ID;
  brandName: string;
  saleable: number;
  damaged: number;
  expired: number;
  inspection: number;
  /** All buckets together. */
  onHand: number;
  /** Saleable quantity that is still within shelf life. */
  available: number;
  daysToExpiry: number;
  expiryStatus: ExpiryStatus;
}

export interface ProductStock {
  productId: ID;
  sku: string;
  name: string;
  brandId: ID;
  brandName: string;
  categoryId: ID;
  categoryName: string;
  unitCode: string;
  packSize: number;
  minStock: number;
  /** Sellable now (saleable bucket, not expired). */
  available: number;
  /** Past expiry but not yet written off (saleable bucket of expired batches + expired bucket). */
  expired: number;
  damaged: number;
  inspection: number;
  batches: number;
  stockStatus: 'ok' | 'low' | 'out';
  /** `available` valued at batch cost. */
  value: number;
}

export type ValuationMethod = 'fifo' | 'weighted_average';

export interface ValuationRow {
  productId: ID;
  sku: string;
  name: string;
  brandName: string;
  qty: number;
  unitCost: number;
  value: number;
  /** Value of damaged/expired/inspection stock still held, at batch cost. */
  heldValue: number;
}

export interface MovementRow extends StockMovement {
  productName: string;
  sku: string;
  batchNo: string;
}
