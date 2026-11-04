import type { ID, ISODateTime } from './common';
import type { ValuationMethod } from './inventory';

export type Role = 'admin' | 'accounts' | 'warehouse' | 'sales';

export type ModuleKey =
  | 'dashboard'
  | 'products'
  | 'inventory'
  | 'purchases'
  | 'distributors'
  | 'distribution'
  | 'sales'
  | 'receivables'
  | 'payables'
  | 'expenses'
  | 'reports'
  | 'admin';

export type PermissionLevel = 'none' | 'view' | 'edit';
export type RolePermissions = Record<Role, Record<ModuleKey, PermissionLevel>>;

export interface User {
  id: ID;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  lastLogin: ISODateTime | null;
}

export interface AuditEntry {
  id: ID;
  at: ISODateTime;
  userId: ID;
  userName: string;
  action: 'create' | 'update' | 'delete' | 'status' | 'login' | 'other';
  entityType: string;
  entityRef: string;
  summary: string;
}

export interface Settings {
  companyName: string;
  gstin: string;
  state: string;
  address: string;
  phone: string;
  email: string;
  valuationMethod: ValuationMethod;
  /** Batches expiring within this many days raise an expiry alert. */
  expiryAlertDays: number;
  defaultCreditDays: number;
  invoiceTerms: string;
}

export interface BackupRecord {
  id: ID;
  date: string;
  time: string;
  type: 'scheduled' | 'manual';
  sizeMb: number;
  status: 'completed' | 'failed';
}
