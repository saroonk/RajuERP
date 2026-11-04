import type { ID, ISODate } from './common';
import type { BatchStock, ProductStock } from './inventory';
import type { InvoiceRow } from './sales';

export interface SalesProfitRow {
  invoiceId: ID;
  invoiceNo: string;
  date: ISODate;
  distributorName: string;
  /** Taxable value net of returns booked against the invoice. */
  revenue: number;
  /** Batch cost of goods invoiced, net of returned goods. */
  cost: number;
  margin: number;
  marginPct: number;
}

export interface SalesProfitReport {
  rows: SalesProfitRow[];
  trend: { month: string; revenue: number; cost: number; margin: number }[];
}

export interface BrandReportRow {
  brandId: ID;
  brandName: string;
  type: 'own' | 'external';
  qtySold: number;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number;
  stockQty: number;
  stockValue: number;
}

export type ProductClass = 'high_selling' | 'average' | 'slow_moving' | 'low_performing';

export interface ProductPerfRow {
  productId: ID;
  sku: string;
  name: string;
  brandName: string;
  qtySold: number;
  revenue: number;
  margin: number;
  stockOnHand: number;
  lastSaleDate: ISODate | null;
  classification: ProductClass;
}

export interface DistributorPerfRow {
  distributorId: ID;
  distributorName: string;
  type: 'distributor' | 'dealer';
  invoices: number;
  taxable: number;
  invoiced: number;
  collected: number;
  outstanding: number;
  returnsValue: number;
  returnPct: number;
  reportedSales: number | null;
}

export interface PurchaseRegisterRow {
  grnId: ID;
  grnNo: string;
  date: ISODate;
  supplierName: string;
  gstin: string;
  supplierInvoiceNo: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface SalesRegisterRow {
  invoiceId: ID;
  invoiceNo: string;
  date: ISODate;
  distributorName: string;
  gstin: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
}

export interface GstSummary {
  byRate: { rate: number; taxable: number; cgst: number; sgst: number; igst: number; tax: number }[];
  byMonth: { month: string; taxable: number; tax: number }[];
  output: {
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    tax: number;
    creditNoteTax: number;
    debitNoteTax: number;
    netTax: number;
  };
  input: { taxable: number; tax: number };
}

export interface DashboardSummary {
  kpis: {
    stockValue: number;
    salesMonth: number;
    salesPrevMonth: number;
    purchasesMonth: number;
    receivables: number;
    overdueReceivables: number;
    payables: number;
    collectionsMonth: number;
    expiringBatches: number;
    expiredBatches: number;
    lowStockProducts: number;
    openOrders: number;
  };
  monthly: { month: string; sales: number; purchases: number; collections: number }[];
  salesByBrand: { name: string; value: number }[];
  topDistributors: { name: string; sales: number; outstanding: number }[];
  recentInvoices: InvoiceRow[];
  expiringSoon: BatchStock[];
  overdue: InvoiceRow[];
  lowStock: ProductStock[];
}
