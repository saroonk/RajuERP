import { useEffect, useMemo } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { useAction } from '@/hooks/useAction';
import { services } from '@/services';
import type { BatchStock, StockBucket } from '@/types';
import { formatCurrency, formatDate, formatNumber, titleCase, today } from '@/utils/format';
import { dateField, numberField, requiredText } from '@/utils/schemas';

const BUCKETS: StockBucket[] = ['expired', 'damaged', 'inspection', 'saleable'];

export interface WriteOffLineInit {
  batchId: string;
  bucket: StockBucket;
  qty: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  batches: BatchStock[];
  initialLines: WriteOffLineInit[];
  initialReason?: string;
}

const emptyLine = { batchId: '', bucket: 'expired' as StockBucket, qty: NaN };

export function WriteOffDialog({ open, onClose, batches, initialLines, initialReason = '' }: Props) {
  const { run, busy } = useAction();
  const withStock = useMemo(() => batches.filter((b) => b.onHand > 0), [batches]);
  const byId = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);

  const schema = useMemo(
    () =>
      z.object({
        date: dateField('Date'),
        reason: requiredText('Reason', 200),
        lines: z
          .array(
            z
              .object({
                batchId: requiredText('Batch'),
                bucket: z.enum(['saleable', 'damaged', 'expired', 'inspection']),
                qty: numberField('Quantity', { int: true, positive: true }),
              })
              .superRefine((l, ctx) => {
                const b = byId.get(l.batchId);
                if (b && l.qty > b[l.bucket]) ctx.addIssue({ code: 'custom', path: ['qty'], message: `Only ${formatNumber(b[l.bucket])} in ${l.bucket} stock` });
              }),
          )
          .min(1, 'Add at least one batch'),
      }),
    [byId],
  );
  type Values = z.infer<typeof schema>;

  const { register, control, handleSubmit, reset, watch, setValue, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { date: today(), reason: '', lines: [emptyLine] } });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  useEffect(() => {
    if (open) reset({ date: today(), reason: initialReason, lines: initialLines.length ? initialLines : [emptyLine] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const lines = watch('lines');
  const bucketsFor = (batchId: string) => {
    const b = byId.get(batchId);
    return BUCKETS.filter((k) => b && b[k] > 0);
  };

  const submit = handleSubmit(async (v) => {
    const saved = await run(() => services.inventory.createWriteOff(v), 'Write-off recorded');
    if (saved) onClose();
  });
  const total = lines.reduce((s, l) => s + (byId.get(l.batchId)?.costPrice ?? 0) * (Number.isFinite(l.qty) ? l.qty : 0), 0);
  const rootError = formState.errors.lines?.message ?? formState.errors.lines?.root?.message;

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={busy}
      size="lg"
      title="Record write-off"
      description="Removes stock from the selected bucket and posts a write-off movement."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="writeoff-form" loading={busy}>Record write-off</Button>
        </>
      }
    >
      <form id="writeoff-form" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Date" required error={formState.errors.date?.message}>
            <Input type="date" {...register('date')} />
          </Field>
          <Field label="Reason" required error={formState.errors.reason?.message} className="sm:col-span-2">
            <Textarea rows={1} placeholder="e.g. Expired stock disposal" {...register('reason')} />
          </Field>
        </div>

        <div className="space-y-3">
          {fields.map((f, i) => {
            const batch = byId.get(lines[i]?.batchId ?? '');
            const buckets = bucketsFor(lines[i]?.batchId ?? '');
            const err = formState.errors.lines?.[i];
            return (
              <div key={f.id} className="rounded-xl bg-slate-50/70 p-3.5 ring-1 ring-slate-900/[0.05]">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
                  <Field label="Batch" required error={err?.batchId?.message} className="sm:col-span-3">
                    <Select
                      placeholder="Select batch…"
                      options={withStock.map((b) => ({ value: b.id, label: `${b.productName} · ${b.batchNo} (exp ${formatDate(b.expiryDate)})` }))}
                      {...register(`lines.${i}.batchId`, {
                        onChange: (e) => {
                          const first = bucketsFor(e.target.value)[0];
                          if (first) {
                            setValue(`lines.${i}.bucket`, first);
                            setValue(`lines.${i}.qty`, byId.get(e.target.value)![first]);
                          }
                        },
                      })}
                    />
                  </Field>
                  <Field label="Stock bucket" error={err?.bucket?.message} className="sm:col-span-2">
                    <Select {...register(`lines.${i}.bucket`)} options={(buckets.length ? buckets : [lines[i]?.bucket ?? 'expired']).map((k) => ({ value: k, label: `${titleCase(k)}${batch ? ` (${formatNumber(batch[k])})` : ''}` }))} />
                  </Field>
                  <Field label="Qty" required error={err?.qty?.message}>
                    <Input type="number" inputMode="numeric" min={1} {...register(`lines.${i}.qty`, { valueAsNumber: true })} />
                  </Field>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
                  <span>{batch ? `Unit cost ${formatCurrency(batch.costPrice)} · value ${formatCurrency(batch.costPrice * (Number.isFinite(lines[i]?.qty) ? lines[i].qty : 0))}` : 'Choose a batch to see its stock'}</span>
                  {fields.length > 1 && (
                    <button type="button" onClick={() => remove(i)} className="inline-flex items-center gap-1 rounded-md p-2 text-red-600 hover:bg-red-50" aria-label={`Remove line ${i + 1}`}>
                      <Trash2 className="h-4 w-4" /> Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {rootError && <p role="alert" className="text-xs text-red-600">{rootError}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => append(emptyLine)}>Add batch</Button>
          <p className="text-sm font-medium">Total value: {formatCurrency(total)}</p>
        </div>
      </form>
    </Modal>
  );
}
