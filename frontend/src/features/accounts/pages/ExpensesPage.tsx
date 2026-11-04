import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { DataTable, type Column } from '@/components/data/DataTable';
import { DateRangeFilter, rangeFor } from '@/components/data/DateRangeFilter';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/Confirm';
import { Field, FilterSelect, Input, Select } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { DateRange, ExpenseRow } from '@/types';
import { formatCurrency, formatDate, inRange, titleCase, today } from '@/utils/format';
import { dateField, numberField, requiredText } from '@/utils/schemas';
import { CategoriesManager } from '../components/CategoriesManager';
import { MODE_VALUES, PAYMENT_MODES } from '../constants';

const schema = z.object({
  date: dateField('Date'),
  categoryId: z.string().min(1, 'Select a category'),
  payee: requiredText('Payee'),
  description: z.string().trim().max(200, 'Too long').default(''),
  amount: numberField('Amount', { positive: true }),
  mode: z.enum(MODE_VALUES),
});
type Values = z.infer<typeof schema>;
const blank: Values = { date: today(), categoryId: '', payee: '', description: '', amount: NaN, mode: 'bank_transfer' };

export default function ExpensesPage() {
  const { can } = useAuth();
  const canEdit = can('expenses', 'edit');
  const confirm = useConfirm();
  const { run, busy } = useAction();
  const lookups = useLookups();
  const expenses = useData(() => services.accounts.expenses.list());
  const [category, setCategory] = useState('');
  const [mode, setMode] = useState('');
  const [range, setRange] = useState<DateRange>(rangeFor('last_6m'));
  const [editing, setEditing] = useState<{ row: ExpenseRow | null } | null>(null);
  const [managing, setManaging] = useState(false);

  const { register, handleSubmit, reset, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: blank });

  const rows = useMemo(
    () => (expenses.data ?? []).filter((e) => (!category || e.categoryId === category) && (!mode || e.mode === mode) && inRange(e.date, range.from, range.to)),
    [expenses.data, category, mode, range],
  );

  const openCreate = () => {
    reset({ ...blank, date: today() });
    setEditing({ row: null });
  };
  const openEdit = (row: ExpenseRow) => {
    reset({ date: row.date, categoryId: row.categoryId, payee: row.payee, description: row.description, amount: row.amount, mode: row.mode });
    setEditing({ row });
  };

  const onSubmit = handleSubmit(async (v) => {
    const row = editing?.row;
    const saved = await run(() => (row ? services.accounts.expenses.update(row.id, v) : services.accounts.expenses.create(v)), row ? 'Expense updated' : 'Expense added');
    if (saved) setEditing(null);
  });

  const remove = async (row: ExpenseRow) => {
    if (await confirm({ title: 'Delete expense?', message: `${row.expenseNo} (${formatCurrency(row.amount)} to ${row.payee}) will be permanently removed.`, confirmLabel: 'Delete', danger: true })) {
      await run(() => services.accounts.expenses.remove(row.id), 'Expense deleted');
    }
  };

  const columns: Column<ExpenseRow>[] = [
    { key: 'no', header: 'Expense', value: (r) => r.expenseNo, primary: true, cell: (r) => <span className="font-medium">{r.expenseNo}</span> },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date) },
    { key: 'cat', header: 'Category', value: (r) => r.categoryName },
    { key: 'payee', header: 'Payee', value: (r) => r.payee },
    { key: 'desc', header: 'Description', value: (r) => r.description, hideOnMobile: true },
    { key: 'mode', header: 'Mode', value: (r) => titleCase(r.mode) },
    { key: 'amount', header: 'Amount', align: 'right', value: (r) => r.amount, cell: (r) => <span className="font-semibold">{formatCurrency(r.amount)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Office expenses"
        description="Operating expenses by category."
        breadcrumbs={[{ label: 'Accounts' }, { label: 'Office expenses' }]}
        actions={
          canEdit && (
            <>
              <Button variant="secondary" icon={<Settings2 className="h-4 w-4" />} onClick={() => setManaging(true)}>Manage categories</Button>
              <Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Add expense</Button>
            </>
          )
        }
      />
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={expenses.loading}
        error={expenses.error}
        onRetry={expenses.reload}
        searchText={(r) => `${r.expenseNo} ${r.payee} ${r.description} ${r.categoryName}`}
        searchPlaceholder="Search expenses…"
        exportName="expenses"
        defaultSort={{ key: 'date', dir: 'desc' }}
        emptyTitle="No expenses in this view"
        emptyDescription={canEdit ? 'Add an expense or widen the period.' : 'Widen the period or clear filters.'}
        emptyAction={canEdit ? <Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Add expense</Button> : undefined}
        filters={
          <>
            <FilterSelect value={category} onChange={setCategory} allLabel="All categories" options={lookups.expenseCategories.map((c) => ({ value: c.id, label: c.name }))} />
            <FilterSelect value={mode} onChange={setMode} allLabel="All modes" options={PAYMENT_MODES} />
            <DateRangeFilter value={range} onChange={setRange} />
          </>
        }
        rowActions={(r) => [
          { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onClick: () => openEdit(r), hidden: !canEdit },
          { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onClick: () => remove(r), danger: true, hidden: !canEdit },
        ]}
        summary={(all) => (
          <div className="flex items-center justify-between">
            <span className="text-neutral-600">{all.length} expenses</span>
            <span className="tabular font-semibold">Total {formatCurrency(all.reduce((s, r) => s + r.amount, 0))}</span>
          </div>
        )}
      />

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        locked={busy}
        title={editing?.row ? `Edit expense ${editing.row.expenseNo}` : 'Add expense'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button type="submit" form="expense-form" loading={busy}>{editing?.row ? 'Save changes' : 'Add expense'}</Button>
          </>
        }
      >
        <form id="expense-form" onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Field label="Date" required error={formState.errors.date?.message}>
            <Input type="date" {...register('date')} />
          </Field>
          <Field label="Category" required error={formState.errors.categoryId?.message}>
            <Select {...register('categoryId')} placeholder="Select…" options={lookups.expenseCategories.map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          <Field label="Payee" required error={formState.errors.payee?.message}>
            <Input {...register('payee')} />
          </Field>
          <Field label="Amount (₹)" required error={formState.errors.amount?.message}>
            <Input type="number" inputMode="decimal" step="any" min={0} {...register('amount', { valueAsNumber: true })} />
          </Field>
          <Field label="Payment mode" required error={formState.errors.mode?.message}>
            <Select {...register('mode')} options={PAYMENT_MODES} />
          </Field>
          <Field label="Description" error={formState.errors.description?.message}>
            <Input {...register('description')} />
          </Field>
        </form>
      </Modal>
      <CategoriesManager open={managing} onClose={() => setManaging(false)} />
    </>
  );
}
