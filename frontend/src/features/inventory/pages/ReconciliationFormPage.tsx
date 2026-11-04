import { useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { Loadable } from '@/components/ui/States';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { BatchStock } from '@/types';
import { cn } from '@/utils/cn';
import { formatDate, formatNumber, today } from '@/utils/format';
import { dateField, numberField, optionalText, requiredText } from '@/utils/schemas';

const schema = z.object({
  date: dateField('Count date'),
  notes: optionalText(300),
  lines: z.array(z.object({ batchId: requiredText('Batch'), physicalQty: numberField('Physical count', { int: true, min: 0 }) })).min(1, 'Add at least one batch to count'),
});
type Values = z.infer<typeof schema>;

function Form({ batches }: { batches: BatchStock[] }) {
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const byId = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);
  const [pick, setPick] = useState('');
  const [pickProduct, setPickProduct] = useState('');
  const { register, control, handleSubmit, watch, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { date: today(), notes: '', lines: [] } });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const lines = watch('lines');
  const added = new Set(lines.map((l) => l.batchId));

  const sorted = useMemo(() => [...batches].sort((a, b) => a.productName.localeCompare(b.productName) || a.expiryDate.localeCompare(b.expiryDate)), [batches]);
  const products = useMemo(() => [...new Map(batches.map((b) => [b.productId, b.productName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [batches]);

  const addBatch = (b: BatchStock) => append({ batchId: b.id, physicalQty: b.saleable });
  const submit = handleSubmit(async (v) => {
    const rec = await run(() => services.inventory.createReconciliation(v), 'Stock count saved as draft');
    if (rec) navigate(`/inventory/reconciliation/${rec.id}`, { replace: true });
  });
  const rootError = formState.errors.lines?.message ?? formState.errors.lines?.root?.message;

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Card>
        <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Count date" required error={formState.errors.date?.message}>
            <Input type="date" {...register('date')} />
          </Field>
          <Field label="Notes" error={formState.errors.notes?.message} className="sm:col-span-2">
            <Textarea rows={1} placeholder="e.g. Monthly cycle count" {...register('notes')} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Batches to count" description="Counts compare against saleable stock; an approved count posts the difference as an adjustment." />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex gap-2">
              <Select aria-label="Batch to add" value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Select a batch…" options={sorted.filter((b) => !added.has(b.id)).map((b) => ({ value: b.id, label: `${b.productName} · ${b.batchNo} (${formatNumber(b.saleable)})` }))} />
              <Button variant="secondary" icon={<Plus className="h-4 w-4" />} disabled={!pick} onClick={() => { addBatch(byId.get(pick)!); setPick(''); }}>Add</Button>
            </div>
            <div className="flex gap-2">
              <Select aria-label="Product to add all batches of" value={pickProduct} onChange={(e) => setPickProduct(e.target.value)} placeholder="Add all batches of a product…" options={products.map(([id, name]) => ({ value: id, label: name }))} />
              <Button
                variant="secondary"
                disabled={!pickProduct}
                onClick={() => {
                  batches.filter((b) => b.productId === pickProduct && b.saleable > 0 && !added.has(b.id)).forEach(addBatch);
                  setPickProduct('');
                }}
              >
                Add all
              </Button>
            </div>
          </div>

          {fields.length === 0 ? (
            <p className="rounded-md border border-dashed border-neutral-300 py-8 text-center text-sm text-neutral-500">No batches added yet.</p>
          ) : (
            <div className="space-y-3">
              {fields.map((f, i) => {
                const b = byId.get(f.batchId);
                const physical = lines[i]?.physicalQty;
                const variance = Number.isFinite(physical) && b ? physical - b.saleable : null;
                return (
                  <div key={f.id} className="grid grid-cols-2 items-end gap-3 rounded-xl bg-slate-50/70 p-3.5 ring-1 ring-slate-900/[0.05] md:grid-cols-[1fr_8rem_9rem_7rem_auto]">
                    <div className="col-span-2 min-w-0 md:col-span-1">
                      <p className="truncate text-sm font-medium text-neutral-900">{b?.productName}</p>
                      <p className="text-xs text-neutral-500">Batch {b?.batchNo} · exp {formatDate(b?.expiryDate)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-500">System qty</p>
                      <p className="tabular text-sm font-medium">{formatNumber(b?.saleable ?? 0)}</p>
                    </div>
                    <Field label="Physical count" error={formState.errors.lines?.[i]?.physicalQty?.message}>
                      <Input type="number" inputMode="numeric" min={0} {...register(`lines.${i}.physicalQty`, { valueAsNumber: true })} />
                    </Field>
                    <div>
                      <p className="text-xs text-neutral-500">Variance</p>
                      <p className={cn('tabular text-sm font-medium', variance !== null && variance < 0 && 'text-red-600', variance !== null && variance > 0 && 'text-emerald-700')}>{variance === null ? '—' : `${variance > 0 ? '+' : ''}${variance}`}</p>
                    </div>
                    <button type="button" onClick={() => remove(i)} className="justify-self-end rounded-md p-2 text-red-600 hover:bg-red-50" aria-label={`Remove ${b?.productName ?? 'batch'}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {rootError && <p role="alert" className="text-xs text-red-600">{rootError}</p>}
        </CardBody>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => navigate('/inventory/reconciliation')} disabled={busy}>Cancel</Button>
        <Button type="submit" loading={busy}>Save as draft</Button>
      </div>
    </form>
  );
}

export default function ReconciliationFormPage() {
  const batches = useData(() => services.inventory.batchStock());
  return (
    <>
      <PageHeader title="New stock count" description="Enter the physical quantity found for each batch." breadcrumbs={[{ label: 'Inventory' }, { label: 'Reconciliation', to: '/inventory/reconciliation' }, { label: 'New count' }]} />
      <Loadable state={batches}>{(data) => <Form batches={data} />}</Loadable>
    </>
  );
}
