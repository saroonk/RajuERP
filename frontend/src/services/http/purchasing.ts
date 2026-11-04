import type { GoodsReceiptRow, PurchaseOrderRow, SupplierOutstanding, SupplierPaymentRow, SupplierReturnRow } from '@/types';
import type { PurchaseService } from '../types';
import { api, getOrUndefined, listAll } from './client';

export const purchases: PurchaseService = {
  orders: {
    list: () => listAll<PurchaseOrderRow>('purchasing/orders/'),
    get: (id) => getOrUndefined<PurchaseOrderRow>(`purchasing/orders/${id}/`),
    create: (input) => api.post<PurchaseOrderRow>('purchasing/orders/', input),
    update: (id, input) => api.put<PurchaseOrderRow>(`purchasing/orders/${id}/`, input),
    setStatus: (id, status) => api.post<PurchaseOrderRow>(`purchasing/orders/${id}/set-status/`, { status }),
    remove: (id) => api.delete(`purchasing/orders/${id}/`),
  },
  receipts: {
    list: () => listAll<GoodsReceiptRow>('purchasing/receipts/'),
    get: (id) => getOrUndefined<GoodsReceiptRow>(`purchasing/receipts/${id}/`),
    create: (input) => api.post<GoodsReceiptRow>('purchasing/receipts/', input),
  },
  returns: {
    list: () => listAll<SupplierReturnRow>('purchasing/returns/'),
    get: (id) => getOrUndefined<SupplierReturnRow>(`purchasing/returns/${id}/`),
    create: (input) => api.post<SupplierReturnRow>('purchasing/returns/', input),
  },
  payments: {
    list: () => listAll<SupplierPaymentRow>('purchasing/payments/'),
    create: (input) => api.post<SupplierPaymentRow>('purchasing/payments/', input),
  },
  outstanding: () => listAll<SupplierOutstanding>('purchasing/outstanding/'),
};
