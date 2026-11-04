import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, Plus, Printer } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { DataTable, type Column } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DescriptionList } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { NoteRow } from '@/types';
import { formatCurrency, formatDate, today } from '@/utils/format';
import { computeLineTax, GST_RATES } from '@/utils/gst';
import { dateField, numberField, requiredText } from '@/utils/schemas';

const schema = z.object({
  type: z.enum(['credit', 'debit']),
  distributorId: z.string().min(1, 'Select a distributor'),
  invoiceId: z.string(),
  date: dateField('Date', { notFuture: true }),
  reason: requiredText('Reason', 200),
  taxable: numberField('Amount', { positive: true }),
  gstRate: z.number({ invalid_type_error: 'Select a GST rate' }),
});
type Values = z.infer<typeof schema>;

const gst = (n: NoteRow) => n.cgst + n.sgst + n.igst;

export default function NotesPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const list = useData(() => services.sales.notes.list());
  const [tab, setTab] = useState('all');
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<NoteRow | null>(null);
  const [printing, setPrinting] = useState<NoteRow | null>(null);
  const canEdit = can('sales', 'edit');
  const presetInvoice = params.get('invoice') ?? '';

  useEffect(() => {
    if (presetInvoice && canEdit) setCreating(true);
  }, [presetInvoice, canEdit]);

  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => window.print(), 150);
    const done = () => setPrinting(null);
    window.addEventListener('afterprint', done);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);

  const rows = useMemo(() => list.data?.filter((n) => tab === 'all' || n.type === tab), [list.data, tab]);
  const closeCreate = () => {
    setCreating(false);
    if (presetInvoice) setParams({}, { replace: true });
  };

  const columns: Column<NoteRow>[] = [
    { key: 'no', header: 'Note no', primary: true, value: (r) => r.noteNo, cell: (r) => <span className="font-medium">{r.noteNo}</span> },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date) },
    { key: 'type', header: 'Type', value: (r) => r.type, cell: (r) => <StatusBadge status={r.type} label={r.type === 'credit' ? 'Credit note' : 'Debit note'} /> },
    { key: 'dist', header: 'Distributor', value: (r) => r.distributorName },
    { key: 'inv', header: 'Against invoice', value: (r) => r.invoiceNo ?? '' },
    { key: 'reason', header: 'Reason', value: (r) => r.reason, hideOnMobile: true },
    { key: 'taxable', header: 'Taxable', align: 'right', value: (r) => r.taxable, cell: (r) => formatCurrency(r.taxable), hideOnMobile: true },
    { key: 'gst', header: 'GST', align: 'right', value: gst, cell: (r) => formatCurrency(gst(r)), hideOnMobile: true },
    { key: 'total', header: 'Total', align: 'right', value: (r) => r.total, cell: (r) => formatCurrency(r.total) },
    { key: 'ret', header: 'Linked return', value: (r) => r.returnNo ?? '', hideOnMobile: true },
  ];

  const counts = { all: list.data?.length ?? 0, credit: list.data?.filter((n) => n.type === 'credit').length ?? 0, debit: list.data?.filter((n) => n.type === 'debit').length ?? 0 };

  return (
    <>
      <div className={printing ? 'no-print' : ''}>
        <PageHeader
          title="Credit & debit notes"
          description="Adjustments to distributor balances. Credit notes reduce what a distributor owes; debit notes increase it."
          actions={canEdit && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New note</Button>}
        />
        <Tabs className="mb-3" value={tab} onChange={setTab} tabs={[{ key: 'all', label: 'All', count: counts.all }, { key: 'credit', label: 'Credit notes', count: counts.credit }, { key: 'debit', label: 'Debit notes', count: counts.debit }]} />
        <DataTable
          data={rows}
          columns={columns}
          rowKey={(r) => r.id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          searchText={(r) => `${r.noteNo} ${r.distributorName} ${r.invoiceNo ?? ''} ${r.reason}`}
          exportName="credit-debit-notes"
          defaultSort={{ key: 'date', dir: 'desc' }}
          emptyTitle="No notes yet"
          emptyDescription="Credit notes are issued for returns and price adjustments; debit notes for extra charges."
          onRowClick={setViewing}
          rowActions={(n) => [
            { label: 'View', icon: <Eye className="h-4 w-4" />, onClick: () => setViewing(n) },
            { label: 'Print', icon: <Printer className="h-4 w-4" />, onClick: () => setPrinting(n) },
          ]}
        />
      </div>

      {creating && <NoteDialog onClose={closeCreate} presetInvoice={presetInvoice} />}

      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `${viewing.type === 'credit' ? 'Credit' : 'Debit'} note ${viewing.noteNo}` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setViewing(null)}>Close</Button>
            <Button icon={<Printer className="h-4 w-4" />} onClick={() => { setPrinting(viewing); setViewing(null); }}>Print</Button>
          </>
        }
      >
        {viewing && <NoteBody note={viewing} />}
      </Modal>

      {printing && (
        <div className="print-only print-area">
          <h1 className="mb-3 text-lg font-bold">{printing.type === 'credit' ? 'Credit note' : 'Debit note'} {printing.noteNo}</h1>
          <NoteBody note={printing} />
        </div>
      )}
    </>
  );
}

function NoteBody({ note: n }: { note: NoteRow }) {
  return (
    <div className="space-y-4">
      <DescriptionList
        items={[
          { label: 'Note no', value: n.noteNo },
          { label: 'Date', value: formatDate(n.date) },
          { label: 'Distributor', value: n.distributorName },
          { label: 'Against invoice', value: n.invoiceNo ?? '—' },
          { label: 'Linked return', value: n.returnNo ?? '—' },
          { label: 'Reason', value: n.reason },
        ]}
      />
      <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
        {[['Taxable value', n.taxable], ...(n.igst ? [['IGST', n.igst]] : [['CGST', n.cgst], ['SGST', n.sgst]]), ...(n.roundOff ? [['Round off', n.roundOff]] : [])].map(([l, v]) => (
          <div key={l as string} className="flex justify-between"><dt className="text-neutral-500">{l}</dt><dd className="tabular">{formatCurrency(v as number)}</dd></div>
        ))}
        <div className="flex justify-between border-t border-neutral-300 pt-1 font-semibold"><dt>Total</dt><dd className="tabular">{formatCurrency(n.total)}</dd></div>
      </dl>
    </div>
  );
}

function NoteDialog({ onClose, presetInvoice }: { onClose: () => void; presetInvoice: string }) {
  const { run, busy } = useAction();
  const lookups = useLookups();
  const invoices = useData(() => services.sales.invoices.list());
  const settings = useData(() => services.admin.settings());
  const preset = invoices.data?.find((i) => i.id === presetInvoice);

  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'credit', distributorId: '', invoiceId: '', date: today(), reason: '', taxable: undefined as unknown as number, gstRate: 18 },
  });

  useEffect(() => {
    if (preset) reset((v) => ({ ...v, distributorId: preset.distributorId, invoiceId: preset.id }));
  }, [preset, reset]);

  const v = watch();
  const dist = lookups.distributor(v.distributorId);
  const inv = invoices.data?.find((i) => i.id === v.invoiceId);
  const interState = inv ? inv.interState : !!dist && !!settings.data && dist.state !== settings.data.state;
  const preview = v.taxable > 0 ? computeLineTax({ qty: 1, rate: v.taxable, discountPct: 0, gstRate: v.gstRate || 0 }, interState) : null;
  const distInvoices = (invoices.data ?? []).filter((i) => i.distributorId === v.distributorId);

  const submit = handleSubmit(async (values) => {
    const saved = await run(() => services.sales.notes.create({ ...values, invoiceId: values.invoiceId || null }), `${values.type === 'credit' ? 'Credit' : 'Debit'} note issued`);
    if (saved) onClose();
  });

  return (
    <Modal
      open
      onClose={onClose}
      locked={busy}
      title="New credit / debit note"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="note-form" loading={busy}>Issue note</Button>
        </>
      }
    >
      <form id="note-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field label="Type" required>
          <Select options={[{ value: 'credit', label: 'Credit note (reduces balance)' }, { value: 'debit', label: 'Debit note (increases balance)' }]} {...register('type')} />
        </Field>
        <Field label="Date" required error={errors.date?.message}>
          <Input type="date" max={today()} {...register('date')} />
        </Field>
        <Field label="Distributor" required error={errors.distributorId?.message}>
          <Select placeholder="Select…" options={lookups.distributors.map((d) => ({ value: d.id, label: d.name }))} {...register('distributorId', { onChange: () => setValue('invoiceId', '') })} />
        </Field>
        <Field label="Against invoice (optional)">
          <Select placeholder="None" disabled={!v.distributorId} options={distInvoices.map((i) => ({ value: i.id, label: `${i.invoiceNo} · ${formatCurrency(i.total)}` }))} {...register('invoiceId')} />
        </Field>
        <Field label="Amount before GST (₹)" required error={errors.taxable?.message}>
          <Input type="number" inputMode="decimal" step="any" {...register('taxable', { valueAsNumber: true })} />
        </Field>
        <Field label="GST rate" required error={errors.gstRate?.message}>
          <Select options={GST_RATES.map((r) => ({ value: String(r), label: `${r}%` }))} {...register('gstRate', { valueAsNumber: true })} />
        </Field>
        <Field label="Reason" required error={errors.reason?.message} className="sm:col-span-2">
          <Textarea rows={2} {...register('reason')} />
        </Field>
        {preview && (
          <dl className="space-y-1 rounded-xl bg-slate-50/80 ring-1 ring-slate-900/[0.04] p-3 text-sm sm:col-span-2">
            <div className="flex justify-between"><dt className="text-neutral-500">Taxable</dt><dd className="tabular">{formatCurrency(preview.taxable)}</dd></div>
            {interState ? (
              <div className="flex justify-between"><dt className="text-neutral-500">IGST</dt><dd className="tabular">{formatCurrency(preview.igst)}</dd></div>
            ) : (
              <>
                <div className="flex justify-between"><dt className="text-neutral-500">CGST</dt><dd className="tabular">{formatCurrency(preview.cgst)}</dd></div>
                <div className="flex justify-between"><dt className="text-neutral-500">SGST</dt><dd className="tabular">{formatCurrency(preview.sgst)}</dd></div>
              </>
            )}
            <div className="flex justify-between border-t border-neutral-200 pt-1 font-semibold"><dt>Note total</dt><dd className="tabular">{formatCurrency(preview.total)}</dd></div>
          </dl>
        )}
      </form>
    </Modal>
  );
}
