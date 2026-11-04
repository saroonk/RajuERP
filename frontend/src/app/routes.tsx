import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ModuleKey } from '@/types';

type Page = LazyExoticComponent<ComponentType>;
export interface AppRoute {
  path: string;
  module: ModuleKey;
  Page: Page;
}

const r = (path: string, module: ModuleKey, load: () => Promise<{ default: ComponentType }>): AppRoute => ({ path, module, Page: lazy(load) });

/** Every screen in the app. `module` decides which role permission opens it. Pages live in features/<area>/pages. */
export const appRoutes: AppRoute[] = [
  r('/', 'dashboard', () => import('@/features/dashboard/pages/DashboardPage')),
  r('/alerts', 'dashboard', () => import('@/features/alerts/pages/AlertsPage')),

  // Products
  r('/products', 'products', () => import('@/features/products/pages/ProductsPage')),
  r('/products/brands', 'products', () => import('@/features/products/pages/BrandsPage')),
  r('/products/categories', 'products', () => import('@/features/products/pages/CategoriesPage')),
  r('/products/units', 'products', () => import('@/features/products/pages/UnitsPage')),

  // Inventory
  r('/inventory', 'inventory', () => import('@/features/inventory/pages/StockOverviewPage')),
  r('/inventory/batches', 'inventory', () => import('@/features/inventory/pages/BatchesPage')),
  r('/inventory/movements', 'inventory', () => import('@/features/inventory/pages/MovementsPage')),
  r('/inventory/valuation', 'inventory', () => import('@/features/inventory/pages/ValuationPage')),
  r('/inventory/write-offs', 'inventory', () => import('@/features/inventory/pages/WriteOffsPage')),
  r('/inventory/reconciliation', 'inventory', () => import('@/features/inventory/pages/ReconciliationListPage')),
  r('/inventory/reconciliation/new', 'inventory', () => import('@/features/inventory/pages/ReconciliationFormPage')),
  r('/inventory/reconciliation/:id', 'inventory', () => import('@/features/inventory/pages/ReconciliationDetailPage')),

  // Purchases
  r('/purchases/orders', 'purchases', () => import('@/features/purchases/pages/PurchaseOrdersPage')),
  r('/purchases/orders/new', 'purchases', () => import('@/features/purchases/pages/PurchaseOrderFormPage')),
  r('/purchases/orders/:id', 'purchases', () => import('@/features/purchases/pages/PurchaseOrderDetailPage')),
  r('/purchases/orders/:id/edit', 'purchases', () => import('@/features/purchases/pages/PurchaseOrderFormPage')),
  r('/purchases/receipts', 'purchases', () => import('@/features/purchases/pages/GoodsReceiptsPage')),
  r('/purchases/receipts/new', 'purchases', () => import('@/features/purchases/pages/GoodsReceiptFormPage')),
  r('/purchases/receipts/:id', 'purchases', () => import('@/features/purchases/pages/GoodsReceiptDetailPage')),
  r('/purchases/returns', 'purchases', () => import('@/features/purchases/pages/SupplierReturnsPage')),
  r('/purchases/returns/new', 'purchases', () => import('@/features/purchases/pages/SupplierReturnFormPage')),
  r('/purchases/suppliers', 'purchases', () => import('@/features/purchases/pages/SuppliersPage')),

  // Distribution
  r('/distribution/distributors', 'distributors', () => import('@/features/distribution/pages/DistributorsPage')),
  r('/distribution/distributors/:id', 'distributors', () => import('@/features/distribution/pages/DistributorDetailPage')),
  r('/distribution/pricing', 'distributors', () => import('@/features/distribution/pages/PricingPage')),
  r('/distribution/orders', 'distribution', () => import('@/features/distribution/pages/OrdersPage')),
  r('/distribution/orders/new', 'distribution', () => import('@/features/distribution/pages/OrderFormPage')),
  r('/distribution/orders/:id', 'distribution', () => import('@/features/distribution/pages/OrderDetailPage')),
  r('/distribution/orders/:id/edit', 'distribution', () => import('@/features/distribution/pages/OrderFormPage')),
  r('/distribution/dispatches', 'distribution', () => import('@/features/distribution/pages/DispatchesPage')),
  r('/distribution/dispatches/new', 'distribution', () => import('@/features/distribution/pages/DispatchFormPage')),
  r('/distribution/dispatches/:id', 'distribution', () => import('@/features/distribution/pages/DispatchDetailPage')),
  r('/distribution/stock', 'distribution', () => import('@/features/distribution/pages/DistributorStockPage')),

  // Sales
  r('/sales/invoices', 'sales', () => import('@/features/sales/pages/InvoicesPage')),
  r('/sales/invoices/:id', 'sales', () => import('@/features/sales/pages/InvoiceDetailPage')),
  r('/sales/notes', 'sales', () => import('@/features/sales/pages/NotesPage')),
  r('/sales/returns', 'sales', () => import('@/features/sales/pages/SalesReturnsPage')),
  r('/sales/returns/new', 'sales', () => import('@/features/sales/pages/SalesReturnFormPage')),
  r('/sales/returns/:id', 'sales', () => import('@/features/sales/pages/SalesReturnDetailPage')),

  // Accounts
  r('/accounts/receivables', 'receivables', () => import('@/features/accounts/pages/ReceivablesPage')),
  r('/accounts/payments', 'receivables', () => import('@/features/accounts/pages/PaymentsPage')),
  r('/accounts/payments/new', 'receivables', () => import('@/features/accounts/pages/PaymentFormPage')),
  r('/accounts/payments/:id', 'receivables', () => import('@/features/accounts/pages/PaymentDetailPage')),
  r('/accounts/ledger', 'receivables', () => import('@/features/accounts/pages/LedgerPage')),
  r('/accounts/ledger/:id', 'receivables', () => import('@/features/accounts/pages/LedgerPage')),
  r('/accounts/payables', 'payables', () => import('@/features/accounts/pages/PayablesPage')),
  r('/accounts/expenses', 'expenses', () => import('@/features/accounts/pages/ExpensesPage')),
  r('/accounts/summary', 'expenses', () => import('@/features/accounts/pages/SummaryPage')),

  // Reports
  r('/reports/sales', 'reports', () => import('@/features/reports/pages/SalesProfitabilityPage')),
  r('/reports/brands', 'reports', () => import('@/features/reports/pages/BrandReportPage')),
  r('/reports/products', 'reports', () => import('@/features/reports/pages/ProductPerformancePage')),
  r('/reports/distributors', 'reports', () => import('@/features/reports/pages/DistributorPerformancePage')),
  r('/reports/registers', 'reports', () => import('@/features/reports/pages/RegistersPage')),
  r('/reports/gst', 'reports', () => import('@/features/reports/pages/GstSummaryPage')),

  // Administration
  r('/admin/users', 'admin', () => import('@/features/admin/pages/UsersPage')),
  r('/admin/roles', 'admin', () => import('@/features/admin/pages/RolesPage')),
  r('/admin/audit', 'admin', () => import('@/features/admin/pages/AuditPage')),
  r('/admin/settings', 'admin', () => import('@/features/admin/pages/SettingsPage')),
];
