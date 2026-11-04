import type { Brand, Category, Distributor, DistributorPrice, Product, SearchResult, Supplier, Unit, UnitConversion } from '@/types';
import type { CrudService, Lookups, Services } from '../types';
import { api, asArray, getOrUndefined, listAll } from './client';

/** Generic REST resource: list (all pages), get, create, update (PATCH), delete. */
export function crud<T extends { id: string }, I = Omit<T, 'id'>>(path: string, update: 'PATCH' | 'PUT' = 'PATCH'): CrudService<T, I> {
  return {
    list: () => listAll<T>(`${path}/`),
    get: (id) => getOrUndefined<T>(`${path}/${id}/`),
    create: (input) => api.post<T>(`${path}/`, input),
    update: (id, input) => (update === 'PATCH' ? api.patch<T>(`${path}/${id}/`, input) : api.put<T>(`${path}/${id}/`, input)),
    remove: (id) => api.delete(`${path}/${id}/`),
  };
}

export const masters: Pick<
  Services,
  'lookups' | 'search' | 'brands' | 'categories' | 'units' | 'unitConversions' | 'products' | 'suppliers' | 'distributors' | 'distributorPrices'
> = {
  lookups: { all: () => api.get<Lookups>('lookups/') },
  search: async (query) => asArray(await api.get<SearchResult[]>('search/', { q: query })),
  brands: crud<Brand>('brands'),
  categories: crud<Category>('categories'),
  units: crud<Unit>('units'),
  unitConversions: crud<UnitConversion>('unit-conversions'),
  products: crud<Product>('products'),
  suppliers: crud<Supplier>('suppliers'),
  distributors: crud<Distributor>('distributors'),
  distributorPrices: crud<DistributorPrice>('distributor-prices'),
};
