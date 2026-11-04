import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { BatchStock, StockBucket } from '@/types';
import { formatCurrency, formatNumber, titleCase, today } from '@/utils/format';
import { computePurchaseTotals } from '@/utils/gst';
import { dateField, numberField, requiredText } from '@/utils/schemas';

const BUCKETS: StockBucket[] = ['saleable', 'damaged', 'expired', 'inspection'];

const schema = z.object({
  supplierId: requiredText('Supplier'),
  date: dateField('Return date'),
  reason: requiredText('Reason', 200),
  lines: z
    .array(z.object({ batchId: requiredText('Batch'), bucket: z.enum(['saleable', 'damaged', 'expired', 'inspection']), qty: numberField('Quantity', { positive: true, int: true }) }))
    .min(1, 'Add at least one batch'),
});
type Values = z.infer<typeof schema>;

const emptyLine = { batchId: '', bucket: 'saleable' as StockBucket, qty: 0 };

export default function SupplierReturnFormPage() {
  const navigate = useNavigate();
  const lk = useLookups();
  const { run, busy } = useAction();
  const stock = useData(() => services.inventory.batchStock());
  const { register, control, handleSubmit, watch, setValue, setError, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { supplierId: '', date: today(), reason: '', lines: [emptyLine] },
  });
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'lines' });
  const supplierId = watch('supplierId');
  const lines = watch('lines');
  const { errors } = formState;

  const batches: BatchStock[] = (stock.data ?? []).filter((b) => b.supplierId === supplierId && b.onHand > 0);
  const batchOf = (id: string) => batches.find((b) => b.id === id);
  const qtyIn = (b: BatchStock | undefined, bucket: StockBucket) => (b ? b[bucket] : 0);

  const priced = lines.map((l) => {
    const b = batchOf(l.batchId);
    return { qty: Number(l.qty) || 0, rate: b?.costPrice ?? 0, gstRate: lk.product(b?.productId)?.gstRate ?? 0 };
  });
  const totals = computePurchaseTotals(priced);

  const submit = handleSubmit(async (v) => {
    let bad = false;
    v.lines.forEach((l, i) => {
      const avail = qtyIn(batchOf(l.batchId), l.bucket);
      if (l.qty > avail) {
        setError(`lines.${i}.qty`, { message: `Only ${formatNumber(avail)} in ${l.bucket} stock` });
        bad = true;
      }
    });
    if (bad) return;
    const ret = await run(() => services.purchases.returns.create(v), 'Supplier return recorded. Stock and supplier balance updated.');
    if (ret) navigate('/purchases/returns');
  });

  return (
    <>
      <PageHeader title="New supplier return" breadcrumbs={[{ label: 'Supplier returns', to: '/purchases/returns' }, { label: 'New' }]} />
      <form onSubmit={submit} noValidate className="space-y-4">
        <Card>
          <CardHeader title="Return details" />
          <CardBody className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <Field label="Supplier" required error={errors.supplierId?.message} className="sm:col-span-2">
              <Select
                placeholder="Select supplier…"
                options={lk.suppliers.map((s) => ({ value: s.id, label: s.name }))}
                {...register('supplierId', { onChange: () => replace([emptyLine]) })}
              />
            </Field>
            <Field label="Return date" required error={errors.date?.message}>
              <Input type="date" {...register('date')} />
            </Field>
            <Field label="Reason" required error={errors.reason?.message} className="sm:col-span-3">
              <Input placeholder="e.g. Damaged on delivery, short shelf life" {...register('reason')} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Batches to return" description="Rate is the batch cost. Returning stock reduces the amount owed to the supplier." />
          <CardBody className="space-y-3">
            {!supplierId && <p className="text-sm text-neutral-500">Select a supplier to see their batches in stock.</p>}
            {supplierId && batches.length === 0 && !stock.loading && <p className="text-sm text-neutral-500">No batches from this supplier have stock on hand.</p>}
            {supplierId &&
              batches.length > 0 &&
              fields.map((f, i) => {
                const l = lines[i];
                const b = batchOf(l?.batchId ?? '');
                const e = errors.lines?.[i];
                const bucketOptions = BUCKETS.filter((k) => qtyIn(b, k) > 0).map((k) => ({ value: k, label: `${titleCase(k)} (${formatNumber(qtyIn(b, k))})` }));
                return (
                  <div key={f.id} className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50/70 p-3.5 ring-1 ring-slate-900/[0.05] sm:grid-cols-12">
                    <Field label="Batch" required error={e?.batchId?.message} className="col-span-2 sm:col-span-6">
                      <Select
                        placeholder="Select batch…"
                        options={batches.map((x) => ({ value: x.id, label: `${x.batchNo} · ${x.productName}` }))}
                        {...register(`lines.${i}.batchId`, {
                          onChange: (ev) => {
                            const nb = batchOf(ev.target.value);
                            const first = BUCKETS.find((k) => qtyIn(nb, k) > 0);
                            if (first) setValue(`lines.${i}.bucket`, first);
                          },
                        })}
                      />
                    </Field>
                    <Field label="Stock type" error={e?.bucket?.message} className="sm:col-span-3">
                      <Select disabled={!b} options={bucketOptions} {...register(`lines.${i}.bucket`)} />
                    </Field>
                    <Field label="Quantity" required error={e?.qty?.message} className="sm:col-span-2">
                      <Input type="number" inputMode="numeric" min={1} step={1} {...register(`lines.${i}.qty`, { valueAsNumber: true })} />
                    </Field>
                    <div className="col-span-2 flex items-end justify-end sm:col-span-1">
                      <Button variant="ghost" size="sm" onClick={() => remove(i)} disabled={fields.length === 1} aria-label={`Remove line ${i + 1}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {b && (
                      <p className="tabular col-span-2 text-xs text-neutral-500 sm:col-span-12">
                        Rate {formatCurrency(b.costPrice)} · GST {lk.product(b.productId)?.gstRate ?? 0}% · expiry {b.expiryDate}
                      </p>
                    )}
                  </div>
                );
              })}
            {errors.lines?.message && <p role="alert" className="text-xs text-red-600">{errors.lines.message}</p>}
            {supplierId && batches.length > 0 && (
              <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => append(emptyLine)}>
                Add batch
              </Button>
            )}
          </CardBody>
        </Card>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <dl className="tabular w-full space-y-1 surface p-5 text-sm sm:order-2 sm:max-w-xs">
            <div className="flex justify-between"><dt className="text-neutral-500">Taxable value</dt><dd>{formatCurrency(totals.taxable)}</dd></div>
            <div className="flex justify-between"><dt className="text-neutral-500">GST</dt><dd>{formatCurrency(totals.tax)}</dd></div>
            <div className="flex justify-between border-t border-neutral-200 pt-1 font-semibold"><dt>Total credit</dt><dd>{formatCurrency(totals.total)}</dd></div>
          </dl>
          <div className="flex flex-col-reverse gap-2 sm:order-1 sm:flex-row [&>*]:w-full sm:[&>*]:w-auto">
            <Button variant="secondary" onClick={() => navigate(-1)} disabled={busy}>Cancel</Button>
            <Button type="submit" loading={busy}>Record return</Button>
          </div>
        </div>
      </form>
    </>
  );
}
