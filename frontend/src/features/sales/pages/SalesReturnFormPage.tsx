import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import { formatCurrency, formatDate, formatNumber, today } from '@/utils/format';
import { dateField } from '@/utils/schemas';

const CLASSES = [
  { value: 'saleable', label: 'Saleable — back to sellable stock' },
  { value: 'damaged', label: 'Damaged — held, not sellable' },
  { value: 'expired', label: 'Expired — held for write-off' },
  { value: 'inspection', label: 'Needs inspection — decide later' },
] as const;
const REASONS = [
  { value: 'expired', label: 'Expired' },
  { value: 'near_expiry', label: 'Near expiry' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'wrong_item', label: 'Wrong item' },
  { value: 'quality_issue', label: 'Quality issue' },
  { value: 'other', label: 'Other' },
];

const schema = z.object({
  distributorId: z.string().min(1, 'Select a distributor'),
  invoiceId: z.string().min(1, 'Select an invoice'),
  date: dateField('Return date', { notFuture: true }),
  reason: z.enum(['expired', 'near_expiry', 'damaged', 'wrong_item', 'quality_issue', 'other']),
  notes: z.string().max(250),
  issueCreditNote: z.boolean(),
  lines: z.array(
    z.object({
      productId: z.string(),
      batchId: z.string(),
      remaining: z.number(),
      qty: z.number({ invalid_type_error: 'Enter a quantity' }).int('Whole numbers only').min(0, 'Cannot be negative'),
      classification: z.enum(['saleable', 'damaged', 'expired', 'inspection']),
    }),
  ),
});
type Values = z.infer<typeof schema>;

export default function SalesReturnFormPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const lookups = useLookups();
  const invoices = useData(() => services.sales.invoices.list());
  const presetInvoice = params.get('invoice') ?? '';
  const [loadedFor, setLoadedFor] = useState('');
  const [info, setInfo] = useState<{ batchNo: string; invoiced: number; returned: number; rate: number }[]>([]);

  const { register, control, handleSubmit, watch, setValue, setError, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { distributorId: '', invoiceId: '', date: today(), reason: 'damaged', notes: '', issueCreditNote: true, lines: [] },
  });
  const { fields, replace } = useFieldArray({ control, name: 'lines' });
  const distributorId = watch('distributorId');
  const invoiceId = watch('invoiceId');
  const lines = watch('lines');
  const invoice = invoices.data?.find((i) => i.id === invoiceId);

  useEffect(() => {
    const p = invoices.data?.find((i) => i.id === presetInvoice);
    if (p) {
      setValue('distributorId', p.distributorId);
      setValue('invoiceId', p.id);
    }
  }, [invoices.data, presetInvoice, setValue]);

  useEffect(() => {
    if (!invoiceId || loadedFor === invoiceId) return;
    let cancelled = false;
    services.sales.returns.returnableLines(invoiceId).then((rows) => {
      if (cancelled) return;
      setLoadedFor(invoiceId);
      const inv = invoices.data?.find((i) => i.id === invoiceId);
      setInfo(rows.map((r) => ({ batchNo: r.batchNo, invoiced: r.invoiced, returned: r.returned, rate: inv?.lines.find((l) => l.productId === r.productId && l.batchId === r.batchId)?.rate ?? 0 })));
      replace(rows.map((r) => ({ productId: r.productId, batchId: r.batchId, remaining: r.remaining, qty: 0, classification: 'saleable' as const })));
    });
    return () => {
      cancelled = true;
    };
  }, [invoiceId, loadedFor, invoices.data, replace]);

  const submit = handleSubmit(async (v) => {
    const picked = v.lines.filter((l) => l.qty > 0);
    if (picked.length === 0) return setError('lines', { message: 'Enter a return quantity for at least one line' });
    const over = v.lines.findIndex((l) => l.qty > l.remaining);
    if (over >= 0) return setError(`lines.${over}.qty`, { message: `At most ${v.lines[over].remaining}` });
    const saved = await run(
      () => services.sales.returns.create({ invoiceId: v.invoiceId, date: v.date, reason: v.reason, notes: v.notes, issueCreditNote: v.issueCreditNote, lines: picked.map((l) => ({ productId: l.productId, batchId: l.batchId, qty: l.qty, classification: l.classification })) }),
      'Return recorded',
    );
    if (saved) navigate(`/sales/returns/${saved.id}`);
  });

  const distInvoices = (invoices.data ?? []).filter((i) => i.distributorId === distributorId);
  const total = lines.reduce((s, l, i) => s + (l.qty || 0) * (info[i]?.rate ?? 0), 0);

  return (
    <>
      <PageHeader title="Record sales return" breadcrumbs={[{ label: 'Sales returns', to: '/sales/returns' }, { label: 'New' }]} />
      <form onSubmit={submit} noValidate className="space-y-4">
        <Card>
          <CardHeader title="Return details" />
          <CardBody className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Distributor" required error={errors.distributorId?.message}>
              <Select placeholder="Select…" options={lookups.distributors.map((d) => ({ value: d.id, label: d.name }))} {...register('distributorId', { onChange: () => { setValue('invoiceId', ''); replace([]); setLoadedFor(''); } })} />
            </Field>
            <Field label="Invoice" required error={errors.invoiceId?.message}>
              <Select placeholder={distributorId ? 'Select invoice…' : 'Select a distributor first'} disabled={!distributorId} options={distInvoices.map((i) => ({ value: i.id, label: `${i.invoiceNo} · ${formatDate(i.date)}` }))} {...register('invoiceId', { onChange: () => setLoadedFor('') })} />
            </Field>
            <Field label="Return date" required error={errors.date?.message}>
              <Input type="date" min={invoice?.date} max={today()} {...register('date')} />
            </Field>
            <Field label="Reason" required>
              <Select options={REASONS} {...register('reason')} />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea rows={1} {...register('notes')} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Returned goods" description="Enter a quantity for each line being returned; leave 0 to skip a line." />
          <CardBody className="space-y-3">
            <p className="flex items-start gap-2 rounded-xl bg-slate-50/80 ring-1 ring-slate-900/[0.04] p-2.5 text-xs text-neutral-600">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Only goods classified as <b>Saleable</b> return to sellable inventory. Damaged and expired goods are held separately; “Needs inspection” stock stays on hold until you decide its disposition.
            </p>
            {errors.lines?.message && <p role="alert" className="text-xs text-red-600">{errors.lines.message}</p>}
            {errors.lines?.root?.message && <p role="alert" className="text-xs text-red-600">{errors.lines.root.message}</p>}
            {!invoiceId && <p className="text-sm text-neutral-500">Choose an invoice to load its returnable lines.</p>}
            {fields.map((f, i) => {
              const e = errors.lines?.[i];
              const meta = info[i];
              const blocked = lines[i]?.remaining === 0;
              return (
                <div key={f.id} className={`rounded-xl bg-slate-50/70 p-3.5 ring-1 ring-slate-900/[0.05] ${blocked ? 'opacity-60' : ''}`}>
                  <p className="text-sm font-medium">{lookups.productName(f.productId)} <span className="font-normal text-neutral-500">· Batch {meta?.batchNo}</span></p>
                  <p className="mt-0.5 text-xs text-neutral-500">Invoiced {formatNumber(meta?.invoiced ?? 0)} · Already returned {formatNumber(meta?.returned ?? 0)} · <b className="text-neutral-800">Returnable {formatNumber(f.remaining)}</b></p>
                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr]">
                    <Field label="Return qty" error={e?.qty?.message}>
                      <Input type="number" inputMode="numeric" min={0} max={f.remaining} disabled={blocked} {...register(`lines.${i}.qty`, { valueAsNumber: true })} />
                    </Field>
                    <Field label="Classification">
                      <Select options={[...CLASSES]} disabled={blocked} {...register(`lines.${i}.classification`)} />
                    </Field>
                  </div>
                </div>
              );
            })}
            {total > 0 && <p className="text-right text-sm">Value of returned goods (before GST): <b className="tabular">{formatCurrency(total)}</b></p>}
          </CardBody>
        </Card>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Checkbox label="Issue credit note for returned goods" {...register('issueCreditNote')} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="secondary" onClick={() => navigate(-1)} disabled={busy}>Cancel</Button>
            <Button type="submit" loading={busy}>Record return</Button>
          </div>
        </div>
      </form>
    </>
  );
}
