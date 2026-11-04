import type { AllocationSuggestion, DistributorBalance, ExpenseCategory, ExpenseRow, IncomeExpenseSummary, InvoiceRow, LedgerEntry, PaymentRow } from '@/types';
import type { AccountsService } from '../types';
import { api, asArray, getOrUndefined, listAll } from './client';
import { crud } from './masters';

export const accounts: AccountsService = {
  balances: () => listAll<DistributorBalance>('finance/balances/'),
  ledger: (distributorId) => listAll<LedgerEntry>('finance/ledger/', { distributorId }),
  openInvoices: (distributorId) => listAll<InvoiceRow>('finance/open-invoices/', { distributorId }),
  suggestAllocations: async (distributorId, amount) => asArray(await api.get<AllocationSuggestion[]>('finance/suggest-allocations/', { distributorId, amount })),
  payments: {
    list: () => listAll<PaymentRow>('finance/payments/'),
    get: (id) => getOrUndefined<PaymentRow>(`finance/payments/${id}/`),
    create: (input) => api.post<PaymentRow>('finance/payments/', input),
    allocate: (id, allocations) => api.post<PaymentRow>(`finance/payments/${id}/allocate/`, { allocations }),
  },
  expenses: {
    list: () => listAll<ExpenseRow>('finance/expenses/'),
    create: (input) => api.post<ExpenseRow>('finance/expenses/', input),
    update: (id, input) => api.put<ExpenseRow>(`finance/expenses/${id}/`, input),
    remove: (id) => api.delete(`finance/expenses/${id}/`),
  },
  expenseCategories: crud<ExpenseCategory>('expense-categories'),
  summary: (range) => api.get<IncomeExpenseSummary>('finance/summary/', { from: range.from, to: range.to }),
};
