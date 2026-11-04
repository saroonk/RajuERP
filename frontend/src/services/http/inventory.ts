import type { Batch, BatchAllocation, BatchStock, AlertSummary, MovementRow, ProductStock, Reconciliation, ValuationRow, WriteOff } from '@/types';
import type { InventoryService } from '../types';
import { api, asArray, getOrUndefined, listAll } from './client';

export const inventory: InventoryService = {
  stockByProduct: () => listAll<ProductStock>('inventory/stock-by-product/'),
  batchStock: () => listAll<BatchStock>('inventory/batches/'),
  movements: () => listAll<MovementRow>('inventory/movements/'),
  valuation: (method) => listAll<ValuationRow>('inventory/valuation/', { method }),
  alerts: () => api.get<AlertSummary>('inventory/alerts/'),
  writeOffs: () => listAll<WriteOff & { lineCount: number; totalQty: number }>('inventory/write-offs/'),
  createWriteOff: (input) => api.post<WriteOff>('inventory/write-offs/', input),
  reconciliations: () => listAll<Reconciliation & { totalVariance: number }>('inventory/reconciliations/'),
  getReconciliation: (id) => getOrUndefined<Reconciliation>(`inventory/reconciliations/${id}/`),
  createReconciliation: (input) => api.post<Reconciliation>('inventory/reconciliations/', input),
  approveReconciliation: (id) => api.post<Reconciliation>(`inventory/reconciliations/${id}/approve/`),
  deleteReconciliation: (id) => api.delete(`inventory/reconciliations/${id}/`),
  suggestAllocation: async (productId, qty, date, exclude) =>
    asArray(
      await api.get<BatchAllocation[]>('inventory/suggest-allocation/', {
        productId,
        qty,
        date,
        exclude: exclude
          ? Object.entries(exclude)
              .map(([batchId, q]) => `${batchId}:${q}`)
              .join(',')
          : undefined,
      }),
    ),
  dispatchableBatches: (productId, date) => listAll<BatchStock>('inventory/dispatchable-batches/', { productId, date }),
  getBatch: (id) => getOrUndefined<Batch>(`inventory/batches/${id}/`),
};
