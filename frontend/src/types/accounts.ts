import type { ID, ISODate, PaymentMode } from './common';

export interface ExpenseCategory {
  id: ID;
  name: string;
}

export interface Expense {
  id: ID;
  expenseNo: string;
  date: ISODate;
  categoryId: ID;
  payee: string;
  description: string;
  amount: number;
  mode: PaymentMode;
}

export interface ExpenseRow extends Expense {
  categoryName: string;
}

export interface IncomeExpenseSummary {
  salesTaxable: number;
  creditNotesTaxable: number;
  debitNotesTaxable: number;
  netIncome: number;
  purchasesTaxable: number;
  supplierReturnsTaxable: number;
  netPurchases: number;
  expensesByCategory: { categoryId: ID; categoryName: string; amount: number }[];
  totalExpenses: number;
  /** netIncome - netPurchases - totalExpenses. Operational view only, not a P&L. */
  operatingResult: number;
  collections: number;
  supplierPayments: number;
  months: { month: string; income: number; purchases: number; expenses: number }[];
}
