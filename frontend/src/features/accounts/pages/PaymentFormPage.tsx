import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/States';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import { cn } from '@/utils/cn';
import { formatCurrency, formatDate, round2, today } from '@/utils/format';
import { dateField, numberField, optionalText } from '@/utils/schemas';
import { MODE_VALUES, PAYMENT_MODES, referenceLabel } from '../constants';

const schema = z.object({
  distributorId: z.string().min(1, 'Select a distributor'),
  date: dateField('Date'),
  amount: numberField('Amount', { positive: true }),
  mode: z.enum(MODE_VALUES),
  reference: optionalText(60),
  notes: optionalText(250),
});
type Values = z.infer<typeof schema>;

export default function PaymentFormPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { run, busy } = useAction();
  const lookups = useLookups();
  const { register, handleSubmit, watch, setValue, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { distributorId: params.get('distributor') ?? '', date: today(), amount: NaN, mode: 'bank_transfer', reference: '', notes: '' },
  });
  const distributorId = watch('distributorId');
  const amount = watch('amount');
  const mode = watch('mode');
  const open = useData(() => (distributorId ? services.accounts.openInvoices(distributorId) : Promise.resolve([])), [distributorId]);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [allocError, setAllocError] = useState('');
  const invoices = useMemo(() => open.data ?? [], [open.data]);

  const num = (id: string) => {
    const v = parseFloat(alloc[id] ?? '');
    return Number.isFinite(v) ? v : 0;
  };
  const allocated = round2(invoices.reduce((s, i) => s + num(i.id), 0));
  const payAmount = Number.isFinite(amount) ? amount : 0;
  const remainder = round2(payAmount - allocated);

  const autoAllocate = async (forAmount = payAmount, forDistributor = distributorId) => {
    if (!forDistributor || !(forAmount > 0)) {
      setAlloc({});
      return;
    }
    const s = await services.accounts.suggestAllocations(forDistributor, forAmount);
    setAlloc(Object.fromEntries(s.filter((x) => x.suggested > 0).map((x) => [x.invoiceId, String(x.suggested)])));
    setAllocError('');
  };

  // `?invoice=ID` pre-fills the distributor and the invoice's outstanding amount.
  const invoiceParam = params.get('invoice');
  useEffect(() => {
    if (!invoiceParam) return;
    let cancelled = false;
    services.sales.invoices.get(invoiceParam).then(async (inv) => {
      if (!inv || cancelled) return;
      setValue('distributorId', inv.distributorId);
      setValue('amount', inv.outstanding);
      // The user asked to pay this specific invoice, so apply the amount to it (not to the oldest open invoice).
      if (!cancelled) setAlloc({ [inv.id]: String(inv.outstanding) });
    });
    return () => {
      cancelled = true;
    };
  }, [invoiceParam, setValue]);

  // Changing the distributor discards allocations made for the previous one.
  const [lastDistributor, setLastDistributor] = useState(distributorId);
  useEffect(() => {
    if (distributorId !== lastDistributor) {
      setLastDistributor(distributorId);
      if (!invoiceParam) setAlloc({});
    }
  }, [distributorId, lastDistributor, invoiceParam]);

  const submit = handleSubmit(async (v) => {
    const rows = invoices.filter((i) => num(i.id) > 0);
    const over = rows.find((i) => num(i.id) > i.outstanding + 0.005);
    if (over) return setAllocError(`Amount for ${over.invoiceNo} exceeds its outstanding ${formatCurrency(over.outstanding)}`);
    if (allocated > v.amount + 0.005) return setAllocError('Allocated total cannot exceed the payment amount');
    setAllocError('');
    const created = await run(
      () => services.accounts.payments.create({ ...v, allocations: rows.map((i) => ({ invoiceId: i.id, amount: num(i.id) })) }),
      'Payment recorded',
    );
    if (created) navigate(`/accounts/payments/${created.id}`);
  });

  return (
    <>
      <PageHeader title="Record payment" description="Record a collection and apply it to invoices. Anything not allocated stays on account." breadcrumbs={[{ label: 'Accounts' }, { label: 'Payments received', to: '/accounts/payments' }, { label: 'New' }]} />
      <form onSubmit={submit} noValidate className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Payment details" />
          <CardBody className="space-y-3.5">
            <Field label="Distributor / dealer" required error={formState.errors.distributorId?.message}>
              <Select {...register('distributorId')} placeholder="Select…" options={lookups.distributors.filter((d) => d.active).map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }))} />
            </Field>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field label="Payment date" required error={formState.errors.date?.message}>
                <Input type="date" max={today()} {...register('date')} />
              </Field>
              <Field label="Amount received (₹)" required error={formState.errors.amount?.message}>
                <Input type="number" inputMode="decimal" step="any" min={0} {...register('amount', { valueAsNumber: true })} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field label="Mode" required error={formState.errors.mode?.message}>
                <Select {...register('mode')} options={PAYMENT_MODES} />
              </Field>
              <Field label={referenceLabel(mode)} error={formState.errors.reference?.message}>
                <Input {...register('reference')} />
              </Field>
            </div>
            <Field label="Notes" error={formState.errors.notes?.message}>
              <Textarea {...register('notes')} />
            </Field>
          </CardBody>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Allocate to invoices"
            description="Oldest due invoices first. Partial payments are fine."
            action={
              <Button variant="secondary" size="sm" onClick={() => autoAllocate()} disabled={!distributorId || !(payAmount > 0)}>
                Auto-allocate
              </Button>
            }
          />
          <CardBody className="space-y-3">
            {!distributorId ? (
              <p className="py-6 text-center text-sm text-neutral-500">Select a distributor to see their open invoices.</p>
            ) : open.loading ? (
              <Spinner />
            ) : invoices.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-500">No open invoices. The full amount will be kept on account.</p>
            ) : (
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl ring-1 ring-slate-900/[0.07]">
                {invoices.map((i) => (
                  <li key={i.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">{i.invoiceNo}</p>
                      <p className="text-xs text-neutral-500">
                        {formatDate(i.date)} · due {formatDate(i.dueDate)}
                        {i.overdue && <span className="ml-1 text-red-600">({i.daysOverdue}d overdue)</span>}
                      </p>
                      <p className="tabular text-xs text-neutral-600">Outstanding {formatCurrency(i.outstanding)}</p>
                    </div>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min={0}
                      aria-label={`Allocate to ${i.invoiceNo}`}
                      placeholder="0.00"
                      value={alloc[i.id] ?? ''}
                      onChange={(e) => setAlloc((a) => ({ ...a, [i.id]: e.target.value }))}
                      className="sm:w-36"
                    />
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-3 gap-3 rounded-xl bg-slate-50/80 ring-1 ring-slate-900/[0.04] p-3 text-sm">
              <div>
                <p className="text-xs text-neutral-500">Amount</p>
                <p className="tabular font-semibold">{formatCurrency(payAmount)}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">Allocated</p>
                <p className="tabular font-semibold">{formatCurrency(allocated)}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">Kept on account</p>
                <p className={cn('tabular font-semibold', remainder < 0 && 'text-red-600')}>{formatCurrency(remainder)}</p>
              </div>
            </div>
            {allocError && (
              <p role="alert" className="text-sm text-red-600">
                {allocError}
              </p>
            )}
            {remainder < 0 && (
              <p role="alert" className="text-sm text-red-600">
                Allocated amount is more than the payment received.
              </p>
            )}
          </CardBody>
        </Card>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end lg:col-span-5">
          <Button variant="secondary" onClick={() => navigate('/accounts/payments')} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={remainder < 0}>
            Record payment
          </Button>
        </div>
      </form>
    </>
  );
}
