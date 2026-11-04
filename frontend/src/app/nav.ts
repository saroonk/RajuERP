import {
  Banknote,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  Building2,
  Calculator,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileMinus,
  FileText,
  FolderTree,
  History,
  Layers,
  LayoutDashboard,
  Package,
  PackageCheck,
  Percent,
  PieChart,
  Receipt,
  RotateCcw,
  Ruler,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  Tags,
  Trash2,
  TrendingUp,
  Truck,
  Undo2,
  UserCog,
  Users,
  Wallet,
  ArrowLeftRight,
  BadgePercent,
  type LucideIcon,
} from 'lucide-react';
import type { ModuleKey } from '@/types';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  module: ModuleKey;
  /** Match only the exact path (needed for parent paths like /inventory). */
  end?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', to: '/', icon: LayoutDashboard, module: 'dashboard', end: true },
      { label: 'Alerts', to: '/alerts', icon: Bell, module: 'dashboard' },
    ],
  },
  {
    label: 'Products',
    items: [
      { label: 'Product master', to: '/products', icon: Package, module: 'products', end: true },
      { label: 'Brands', to: '/products/brands', icon: Tags, module: 'products' },
      { label: 'Categories', to: '/products/categories', icon: FolderTree, module: 'products' },
      { label: 'Units & packaging', to: '/products/units', icon: Ruler, module: 'products' },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { label: 'Stock overview', to: '/inventory', icon: Boxes, module: 'inventory', end: true },
      { label: 'Batches & expiry', to: '/inventory/batches', icon: Layers, module: 'inventory' },
      { label: 'Stock movements', to: '/inventory/movements', icon: ArrowLeftRight, module: 'inventory' },
      { label: 'Stock valuation', to: '/inventory/valuation', icon: Calculator, module: 'inventory' },
      { label: 'Expired write-offs', to: '/inventory/write-offs', icon: Trash2, module: 'inventory' },
      { label: 'Reconciliation', to: '/inventory/reconciliation', icon: ClipboardCheck, module: 'inventory' },
    ],
  },
  {
    label: 'Purchases',
    items: [
      { label: 'Purchase orders', to: '/purchases/orders', icon: ShoppingCart, module: 'purchases' },
      { label: 'Goods receipts', to: '/purchases/receipts', icon: PackageCheck, module: 'purchases' },
      { label: 'Supplier returns', to: '/purchases/returns', icon: Undo2, module: 'purchases' },
      { label: 'Suppliers', to: '/purchases/suppliers', icon: Building2, module: 'purchases' },
    ],
  },
  {
    label: 'Distribution',
    items: [
      { label: 'Distributors & dealers', to: '/distribution/distributors', icon: Users, module: 'distributors' },
      { label: 'Pricing & terms', to: '/distribution/pricing', icon: BadgePercent, module: 'distributors' },
      { label: 'Orders', to: '/distribution/orders', icon: ClipboardList, module: 'distribution' },
      { label: 'Dispatches', to: '/distribution/dispatches', icon: Truck, module: 'distribution' },
      { label: 'Distributor stock', to: '/distribution/stock', icon: Store, module: 'distribution' },
    ],
  },
  {
    label: 'Sales',
    items: [
      { label: 'Invoices', to: '/sales/invoices', icon: FileText, module: 'sales' },
      { label: 'Credit & debit notes', to: '/sales/notes', icon: FileMinus, module: 'sales' },
      { label: 'Sales returns', to: '/sales/returns', icon: RotateCcw, module: 'sales' },
    ],
  },
  {
    label: 'Accounts',
    items: [
      { label: 'Receivables', to: '/accounts/receivables', icon: Wallet, module: 'receivables' },
      { label: 'Payments received', to: '/accounts/payments', icon: CreditCard, module: 'receivables' },
      { label: 'Distributor ledger', to: '/accounts/ledger', icon: BookOpen, module: 'receivables' },
      { label: 'Payables', to: '/accounts/payables', icon: Banknote, module: 'payables' },
      { label: 'Office expenses', to: '/accounts/expenses', icon: Receipt, module: 'expenses' },
      { label: 'Income & expense', to: '/accounts/summary', icon: PieChart, module: 'expenses' },
    ],
  },
  {
    label: 'Reports',
    items: [
      { label: 'Sales & profitability', to: '/reports/sales', icon: TrendingUp, module: 'reports' },
      { label: 'Brand-wise', to: '/reports/brands', icon: Tags, module: 'reports' },
      { label: 'Product performance', to: '/reports/products', icon: BarChart3, module: 'reports' },
      { label: 'Distributor performance', to: '/reports/distributors', icon: Users, module: 'reports' },
      { label: 'Purchase & sales registers', to: '/reports/registers', icon: BookOpen, module: 'reports' },
      { label: 'GST summary', to: '/reports/gst', icon: Percent, module: 'reports' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Users', to: '/admin/users', icon: UserCog, module: 'admin' },
      { label: 'Roles & permissions', to: '/admin/roles', icon: ShieldCheck, module: 'admin' },
      { label: 'Audit trail', to: '/admin/audit', icon: History, module: 'admin' },
      { label: 'Settings & backup', to: '/admin/settings', icon: Settings, module: 'admin' },
    ],
  },
];

/** Finds the nav group/item for a pathname (longest matching `to` wins). */
export function findNav(pathname: string): { group: NavGroup; item: NavItem } | undefined {
  let best: { group: NavGroup; item: NavItem } | undefined;
  for (const group of NAV) {
    for (const item of group.items) {
      const match = item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
      if (match && (!best || item.to.length > best.item.to.length)) best = { group, item };
    }
  }
  return best;
}
