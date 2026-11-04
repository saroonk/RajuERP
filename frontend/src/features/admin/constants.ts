import type { ModuleKey, Role } from '@/types';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator',
  accounts: 'Accounts',
  warehouse: 'Warehouse',
  sales: 'Sales',
};

export const ROLES = Object.keys(ROLE_LABELS) as Role[];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  dashboard: 'Dashboard',
  products: 'Products',
  inventory: 'Inventory',
  purchases: 'Purchases',
  distributors: 'Distributors & dealers',
  distribution: 'Distribution orders & dispatch',
  sales: 'Sales & invoicing',
  receivables: 'Receivables',
  payables: 'Payables',
  expenses: 'Expenses & summary',
  reports: 'Reports',
  admin: 'Administration',
};

export const MODULES = Object.keys(MODULE_LABELS) as ModuleKey[];
