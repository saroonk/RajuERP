import type { DispatchRow, DistributionOrderRow, DistributorStockReport, DistributorStockReportRow, DistributorStockRow } from '@/types';
import type { DistributionService, ImportResult } from '../types';
import { api, getOrUndefined, listAll } from './client';

export const distribution: DistributionService = {
  orders: {
    list: () => listAll<DistributionOrderRow>('distribution/orders/'),
    get: (id) => getOrUndefined<DistributionOrderRow>(`distribution/orders/${id}/`),
    create: (input) => api.post<DistributionOrderRow>('distribution/orders/', input),
    update: (id, input) => api.put<DistributionOrderRow>(`distribution/orders/${id}/`, input),
    confirm: (id) => api.post<DistributionOrderRow>(`distribution/orders/${id}/confirm/`),
    cancel: (id) => api.post<DistributionOrderRow>(`distribution/orders/${id}/cancel/`),
    remove: (id) => api.delete(`distribution/orders/${id}/`),
  },
  dispatches: {
    list: () => listAll<DispatchRow>('distribution/dispatches/'),
    get: (id) => getOrUndefined<DispatchRow>(`distribution/dispatches/${id}/`),
    create: (input) => api.post<DispatchRow>('distribution/dispatches/', input),
  },
  stock: () => listAll<DistributorStockRow>('distribution/stock/'),
  stockReports: () => listAll<DistributorStockReportRow>('distribution/stock-reports/'),
  addStockReport: (input) => api.post<DistributorStockReport>('distribution/stock-reports/', input),
  importStockReports: (rows) => api.post<ImportResult>('distribution/stock-reports/import/', { rows }),
  deleteStockReport: (id) => api.delete(`distribution/stock-reports/${id}/`),
};
