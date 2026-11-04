import { useMemo } from 'react';
import { services } from '@/services';
import type { Brand, Category, Distributor, ExpenseCategory, Product, Supplier, Unit } from '@/types';
import { useData } from './useData';

/** Master data, loaded once per page, with id -> record helpers. */
export function useLookups() {
  const { data, loading } = useData(() => services.lookups.all());
  return useMemo(() => {
    const brands: Brand[] = data?.brands ?? [];
    const categories: Category[] = data?.categories ?? [];
    const units: Unit[] = data?.units ?? [];
    const products: Product[] = data?.products ?? [];
    const suppliers: Supplier[] = data?.suppliers ?? [];
    const distributors: Distributor[] = data?.distributors ?? [];
    const expenseCategories: ExpenseCategory[] = data?.expenseCategories ?? [];
    const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
    const m = {
      brand: byId(brands),
      category: byId(categories),
      unit: byId(units),
      product: byId(products),
      supplier: byId(suppliers),
      distributor: byId(distributors),
    };
    return {
      loading,
      brands,
      categories,
      /** Top-level categories only. */
      topCategories: categories.filter((c) => !c.parentId),
      subcategories: categories.filter((c) => c.parentId),
      units,
      products,
      suppliers,
      distributors,
      expenseCategories,
      brand: (id: string | null | undefined) => (id ? m.brand.get(id) : undefined),
      category: (id: string | null | undefined) => (id ? m.category.get(id) : undefined),
      unit: (id: string | null | undefined) => (id ? m.unit.get(id) : undefined),
      product: (id: string | null | undefined) => (id ? m.product.get(id) : undefined),
      supplier: (id: string | null | undefined) => (id ? m.supplier.get(id) : undefined),
      distributor: (id: string | null | undefined) => (id ? m.distributor.get(id) : undefined),
      productName: (id: string) => m.product.get(id)?.name ?? id,
    };
  }, [data, loading]);
}

export type Lookups = ReturnType<typeof useLookups>;
