import type { DispatchRow, InvoiceRow, NoteRow, SalesReturnRow } from '@/types';
import type { SalesService } from '../types';
import { api, asArray, getOrUndefined, listAll } from './client';

type Returnable = Awaited<ReturnType<SalesService['returns']['returnableLines']>>;

export const sales: SalesService = {
  invoices: {
    list: () => listAll<InvoiceRow>('sales/invoices/'),
    get: (id) => getOrUndefined<InvoiceRow>(`sales/invoices/${id}/`),
    uninvoicedDispatches: () => listAll<DispatchRow>('sales/invoices/uninvoiced-dispatches/'),
    createFromDispatch: (dispatchId, date) => api.post<InvoiceRow>('sales/invoices/', { dispatchId, date }),
  },
  notes: {
    list: () => listAll<NoteRow>('sales/notes/'),
    create: (input) => api.post<NoteRow>('sales/notes/', input),
  },
  returns: {
    list: () => listAll<SalesReturnRow>('sales/returns/'),
    get: (id) => getOrUndefined<SalesReturnRow>(`sales/returns/${id}/`),
    returnableLines: async (invoiceId) => asArray(await api.get<Returnable>('sales/returns/returnable-lines/', { invoiceId })),
    create: (input) => api.post<SalesReturnRow>('sales/returns/', input),
    reclassify: (id, lineIndex, to, note) => api.post<SalesReturnRow>(`sales/returns/${id}/reclassify/`, { lineIndex, to, note }),
  },
};
