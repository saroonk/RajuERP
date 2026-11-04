import type { BatchStock, ProductStock } from './inventory';
import type { DistributorBalance, InvoiceRow } from './sales';

export interface AlertSummary {
  expiring: BatchStock[];
  expired: BatchStock[];
  lowStock: ProductStock[];
  overdue: InvoiceRow[];
  overLimit: DistributorBalance[];
  pendingInspection: number;
  total: number;
}

export interface SearchResult {
  type: 'Product' | 'Batch' | 'Invoice' | 'Supplier' | 'Distributor' | 'Purchase order' | 'Order' | 'Payment';
  label: string;
  sub: string;
  href: string;
}
