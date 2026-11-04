import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Banknote, Plus } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/ui/Card';
import { Field, FilterSelect, Input, Select, Textarea } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { SupplierOutstanding, SupplierPaymentRow } from '@/types';
import { cn } from '@/utils/cn';
import { formatCurrency, formatDate, formatNumber, monthKey, titleCase, today } from '@/utils/format';
import { dateField, numberField, optionalText } from '@/utils/schemas';
import { MODE_VALUES, PAYMENT_MODES, referenceLabel } from '../constants';

const schema = z.object({
  supplierId: z.string().min(1, 'Select a supplier'),
  date: dateField('Date'),
  amount: numberField('Amount', { positive: true }),
  mode: z.enum(MODE_VALUES),
  reference: optionalText(60),
  notes: optionalText(250),
});
type Values = z.infer<typeof schema>;

export default function PayablesPage() {
  const { can } = useAuth();
  const canEdit = can('payables', 'edit');
  const [tab, setTab] = useState('outstanding');
  const [supplier, setSupplier] = useState('');
  const [paying, setPaying] = useState<string | null>(null);
  const outstanding = useData(() => services.purchases.outstanding());
  const payments = useData(() => services.purchases.payments.list());
  const lookups = useLookups();

  const o = outstanding.data ?? [];
  const totalPayable = o.reduce((s, x) => s + Math.max(0, x.outstanding), 0);
  const thisMonth = monthKey(today());
  const paidMonth = (payments.data ?? []).filter((p) => monthKey(p.date) === thisMonth).reduce((s, p) => s + p.amount, 0);
  const withBalance = o.filter((x) => x.outstanding > 0.005).length;
  const paymentRows = useMemo(() => (payments.data ?? []).filter((p) => !supplier || p.supplierId === supplier), [payments.data, supplier]);

  const outColumns: Column<SupplierOutstanding>[] = [
    { key: 'name', header: 'Supplier', value: (r) => r.supplierName, primary: true, cell: (r) => <span className="font-medium">{r.supplierName}</span> },
    { key: 'gstin', header: 'GSTIN', value: (r) => r.gstin, hideOnMobile: true },
    { key: 'purchases', header: 'Purchases', align: 'right', value: (r) => r.purchases, cell: (r) => formatCurrency(r.purchases) },
    { key: 'returns', header: 'Returns', align: 'right', value: (r) => r.returns, cell: (r) => formatCurrency(r.returns) },
    { key: 'paid', header: 'Paid', align: 'right', value: (r) => r.paid, cell: (r) => formatCurrency(r.paid) },
    { key: 'out', header: 'Outstanding', align: 'right', value: (r) => r.outstanding, cell: (r) => <span className={cn('font-semibold', r.outstanding > 0.005 && 'text-amber-700')}>{formatCurrency(r.outstanding)}</span> },
    { key: 'last', header: 'Last payment', value: (r) => r.lastPaymentDate, cell: (r) => formatDate(r.lastPaymentDate) },
  ];

  const payColumns: Column<SupplierPaymentRow>[] = [
    { key: 'no', header: 'Payment', value: (r) => r.paymentNo, primary: true, cell: (r) => <span className="font-medium">{r.paymentNo}</span> },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date) },
    { key: 'supplier', header: 'Supplier', value: (r) => r.supplierName },
    { key: 'mode', header: 'Mode', value: (r) => titleCase(r.mode) },
    { key: 'ref', header: 'Reference', value: (r) => r.reference, hideOnMobile: true },
    { key: 'amount', header: 'Amount', align: 'right', value: (r) => r.amount, cell: (r) => <span className="font-semibold">{formatCurrency(r.amount)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Payables"
        description="What is owed to each supplier after goods receipts, supplier returns and payments."
        breadcrumbs={[{ label: 'Accounts' }, { label: 'Payables' }]}
        actions={canEdit && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setPaying('')}>Record payment</Button>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Total payable" value={formatCurrency(totalPayable)} icon={<Banknote className="h-4 w-4" />} />
        <StatCard label="Paid this month" value={formatCurrency(paidMonth)} />
        <StatCard label="Suppliers with balance" value={formatNumber(withBalance)} hint={`of ${o.length} suppliers`} />
      </div>
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ key: 'outstanding', label: 'Supplier outstanding', count: o.length }, { key: 'payments', label: 'Payments made', count: payments.data?.length }]} />

      {tab === 'outstanding' ? (
        <DataTable
          data={o}
          columns={outColumns}
          rowKey={(r) => r.supplierId}
          loading={outstanding.loading}
          error={outstanding.error}
          onRetry={outstanding.reload}
          searchText={(r) => `${r.supplierName} ${r.gstin}`}
          searchPlaceholder="Search suppliers…"
          exportName="supplier-outstanding"
          defaultSort={{ key: 'out', dir: 'desc' }}
          emptyTitle="No suppliers"
          rowActions={(r) => [{ label: 'Record payment', icon: <Banknote className="h-4 w-4" />, onClick: () => setPaying(r.supplierId), hidden: !canEdit }]}
          summary={(rows) => <div className="flex justify-between"><span className="text-neutral-600">Total outstanding</span><span className="tabular font-semibold">{formatCurrency(rows.reduce((s, r) => s + r.outstanding, 0))}</span></div>}
        />
      ) : (
        <DataTable
          data={paymentRows}
          columns={payColumns}
          rowKey={(r) => r.id}
          loading={payments.loading}
          error={payments.error}
          onRetry={payments.reload}
          searchText={(r) => `${r.paymentNo} ${r.supplierName} ${r.reference}`}
          searchPlaceholder="Search payments…"
          exportName="supplier-payments"
          defaultSort={{ key: 'date', dir: 'desc' }}
          emptyTitle="No supplier payments recorded"
          filters={<FilterSelect value={supplier} onChange={setSupplier} allLabel="All suppliers" options={lookups.suppliers.map((s) => ({ value: s.id, label: s.name }))} />}
          summary={(rows) => <div className="flex justify-between"><span className="text-neutral-600">{rows.length} payments</span><span className="tabular font-semibold">{formatCurrency(rows.reduce((s, r) => s + r.amount, 0))}</span></div>}
        />
      )}
      <PaymentModal supplierId={paying} onClose={() => setPaying(null)} outstanding={o} />
    </>
  );
}

function PaymentModal({ supplierId, onClose, outstanding }: { supplierId: string | null; onClose: () => void; outstanding: SupplierOutstanding[] }) {
  return (
    <Modal open={supplierId !== null} onClose={onClose} title="Record supplier payment" size="md">
      {supplierId !== null && <PaymentForm initialSupplier={supplierId} onClose={onClose} outstanding={outstanding} />}
    </Modal>
  );
}

function PaymentForm({ initialSupplier, onClose, outstanding }: { initialSupplier: string; onClose: () => void; outstanding: SupplierOutstanding[] }) {
  const { run, busy } = useAction();
  const lookups = useLookups();
  const due = (id: string) => outstanding.find((x) => x.supplierId === id)?.outstanding ?? 0;
  const { register, handleSubmit, watch, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { supplierId: initialSupplier, date: today(), amount: initialSupplier && due(initialSupplier) > 0 ? due(initialSupplier) : NaN, mode: 'bank_transfer', reference: '', notes: '' },
  });
  const supplierId = watch('supplierId');
  const amount = watch('amount');
  const mode = watch('mode');
  const exceeds = !!supplierId && Number.isFinite(amount) && amount > due(supplierId) + 0.005;

  const submit = handleSubmit(async (v) => {
    const res = await run(() => services.purchases.payments.create(v), 'Supplier payment recorded');
    if (res) onClose();
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-3.5">
      <Field label="Supplier" required error={formState.errors.supplierId?.message} hint={supplierId ? `Outstanding: ${formatCurrency(due(supplierId))}` : undefined}>
        <Select {...register('supplierId')} placeholder="Select…" options={lookups.suppliers.map((s) => ({ value: s.id, label: s.name }))} />
      </Field>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field label="Date" required error={formState.errors.date?.message}>
          <Input type="date" max={today()} {...register('date')} />
        </Field>
        <Field label="Amount (₹)" required error={formState.errors.amount?.message}>
          <Input type="number" inputMode="decimal" step="any" min={0} {...register('amount', { valueAsNumber: true })} />
        </Field>
      </div>
      {exceeds && <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">This is more than the outstanding balance; the excess will show as an advance to the supplier.</p>}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field label="Mode" required>
          <Select {...register('mode')} options={PAYMENT_MODES} />
        </Field>
        <Field label={referenceLabel(mode)} error={formState.errors.reference?.message}>
          <Input {...register('reference')} />
        </Field>
      </div>
      <Field label="Notes" error={formState.errors.notes?.message}>
        <Textarea {...register('notes')} />
      </Field>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" loading={busy}>Record payment</Button>
      </div>
    </form>
  );
}
