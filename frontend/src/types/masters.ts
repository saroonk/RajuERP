import type { ID } from './common';

export interface Brand {
  id: ID;
  name: string;
  /** `own` = company-owned brand, `external` = third-party brand we distribute. */
  type: 'own' | 'external';
  active: boolean;
  notes?: string;
}

/** Categories and subcategories share one table; a subcategory has a `parentId`. */
export interface Category {
  id: ID;
  name: string;
  parentId: ID | null;
  active: boolean;
}

export interface Unit {
  id: ID;
  name: string;
  code: string;
}

/** 1 `fromUnit` = `factor` x `toUnit` (e.g. 1 Box = 12 Pcs). */
export interface UnitConversion {
  id: ID;
  fromUnitId: ID;
  toUnitId: ID;
  factor: number;
}

export interface Product {
  id: ID;
  sku: string;
  name: string;
  brandId: ID;
  categoryId: ID;
  subcategoryId: ID | null;
  /** Base stocking unit. All transaction quantities are in this unit. */
  unitId: ID;
  packUnitId: ID;
  /** Base units per pack, e.g. 12 pieces per box. */
  packSize: number;
  purchasePrice: number;
  sellingPrice: number;
  gstRate: number;
  hsnCode?: string;
  /** Low-stock alert threshold (base units of saleable stock). */
  minStock: number;
  active: boolean;
}

export interface Supplier {
  id: ID;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  city: string;
  state: string;
  active: boolean;
}

export interface Distributor {
  id: ID;
  code: string;
  name: string;
  type: 'distributor' | 'dealer';
  contactPerson: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  city: string;
  state: string;
  creditLimit: number;
  /** Days after invoice date that payment is due. */
  creditDays: number;
  paymentTerms: string;
  active: boolean;
}

export interface DistributorPrice {
  id: ID;
  distributorId: ID;
  productId: ID;
  /** Net price per base unit before discount. */
  price: number;
  discountPct: number;
  terms: string;
}
