import { useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Info } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/States';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { PurchaseOrderRow } from '@/types';
import { addDays, formatCurrency, formatNumber, today } from '@/utils/format';
import { dateField, numberField, requiredText } from '@/utils/schemas';

const schema = z.object({
  date: dateField('Receipt date'),
  supplierInvoiceNo: requiredText('Supplier invoice no', 40),
  lines: z.array(
    z.object({
      productId: z.string(),
      qty: numberField('Quantity', { min: 0 }),
      batchNo: z.string().trim(),
      mfgDate: z.string(),
      expiryDate: z.string(),
    }),
  ),
});
type Values = z.infer<typeof schema>;

const batchSuggestion = (sku: string, date: string) => `${sku.split('-')[1] ?? sku}-${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}`;

export default function GoodsReceiptFormPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const lk = useLookups();
  const { run, busy } = useAction();
  const orders = useData(() => services.purchases.orders.list());
  const [poId, setPoId] = useState(params.get('po') ?? '');
  const open = useMemo(() => orders.data?.filter((o) => o.status === 'ordered' || o.status === 'partial') ?? [], [orders.data]);
  const po: PurchaseOrderRow | undefined = open.find((o) => o.id === poId);

  const { register, control, handleSubmit, reset, getValues, setError, watch, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { date: today(), supplierInvoiceNo: '', lines: [] },
  });
  const { fields } = useFieldArray({ control, name: 'lines' });
  const { errors } = formState;
  const lines = watch('lines');

  // Load the pending lines whenever a different PO is chosen.
  useEffect(() => {
    if (!po) {
      reset({ ...getValues(), lines: [] });
      return;
    }
    const date = getValues('date') || today();
    reset({
      date,
      supplierInvoiceNo: getValues('supplierInvoiceNo'),
      lines: po.lineProgress.map((l) => ({
        productId: l.productId,
        qty: l.pending,
        batchNo: batchSuggestion(lk.product(l.productId)?.sku ?? l.productId, date),
        mfgDate: addDays(date, -7),
        expiryDate: '',
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po?.id, lk.products.length]);

  const submit = handleSubmit(async (v) => {
    if (!po) return;
    let bad = false;
    const fail = (i: number, field: 'qty' | 'batchNo' | 'mfgDate' | 'expiryDate', message: string) => {
      setError(`lines.${i}.${field}`, { message });
      bad = true;
    };
    const chosen = v.lines
      .map((l, i) => ({ ...l, i }))
      .filter((l) => l.qty > 0);
    if (chosen.length === 0) {
      setError('root', { message: 'Enter a received quantity for at least one line' });
      return;
    }
    for (const l of chosen) {
      const pending = po.lineProgress.find((p) => p.productId === l.productId)?.pending ?? 0;
      if (l.qty > pending) fail(l.i, 'qty', `Cannot exceed pending (${formatNumber(pending)})`);
      if (!l.batchNo) fail(l.i, 'batchNo', 'Enter batch no');
      if (!l.mfgDate) fail(l.i, 'mfgDate', 'Enter mfg date');
      if (!l.expiryDate) fail(l.i, 'expiryDate', 'Enter expiry date');
      else {
        if (l.mfgDate && l.expiryDate <= l.mfgDate) fail(l.i, 'expiryDate', 'Must be after mfg date');
        if (l.expiryDate <= v.date) fail(l.i, 'expiryDate', 'Already expired on receipt date');
      }
    }
    if (bad) return;
    const grn = await run(
      () =>
        services.purchases.receipts.create({
          poId: po.id,
          date: v.date,
          supplierInvoiceNo: v.supplierInvoiceNo,
          lines: chosen.map((l) => ({ productId: l.productId, batchNo: l.batchNo, mfgDate: l.mfgDate, expiryDate: l.expiryDate, qty: l.qty })),
        }),
      'Goods received. Stock has been added to inventory by batch.',
    );
    if (grn) navigate(`/purchases/receipts/${grn.id}`);
  });

  if (orders.loading) return <Spinner />;

  return (
    <>
      <PageHeader title="Receive goods" description="Record goods received against a purchase order." breadcrumbs={[{ label: 'Goods receipts', to: '/purchases/receipts' }, { label: 'New' }]} />
      <form onSubmit={submit} noValidate className="space-y-4">
        <Card>
          <CardHeader title="Receipt details" />
          <CardBody className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <Field label="Purchase order" required className="sm:col-span-3" hint={open.length === 0 ? 'There are no open purchase orders to receive against.' : undefined}>
              <Select value={poId} onChange={(e) => setPoId(e.target.value)} placeholder="Select an open purchase order…" options={open.map((o) => ({ value: o.id, label: `${o.poNo} · ${o.supplierName} · ${formatCurrency(o.total)}` }))} />
            </Field>
            <Field label="Receipt date" required error={errors.date?.message}>
              <Input type="date" {...register('date')} />
            </Field>
            <Field label="Supplier invoice no" required error={errors.supplierInvoiceNo?.message} className="sm:col-span-2">
              <Input {...register('supplierInvoiceNo')} />
            </Field>
          </CardBody>
        </Card>

        {po && (
          <Card>
            <CardHeader title="Received quantities" description="Set quantity to 0 to skip a line. Batch, manufacturing and expiry dates are required for every received line." />
            <CardBody className="space-y-3">
              <p className="flex items-start gap-2 rounded-xl bg-slate-50/80 ring-1 ring-slate-900/[0.04] p-3 text-xs text-neutral-600">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Stock is added per batch as saleable inventory. Receiving the same batch number again tops up that batch (expiry must match).
              </p>
              {fields.map((f, i) => {
                const p = po.lineProgress.find((x) => x.productId === lines[i]?.productId);
                const e = errors.lines?.[i];
                return (
                  <div key={f.id} className="rounded-xl bg-slate-50/70 p-3.5 ring-1 ring-slate-900/[0.05]">
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
                      <p className="text-sm font-medium">{lk.productName(lines[i]?.productId ?? '')}</p>
                      <p className="text-xs text-neutral-500">Ordered {formatNumber(p?.ordered ?? 0)} · received {formatNumber(p?.received ?? 0)} · pending {formatNumber(p?.pending ?? 0)}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Field label="Qty received" error={e?.qty?.message}>
                        <Input type="number" inputMode="numeric" min={0} step={1} {...register(`lines.${i}.qty`, { valueAsNumber: true })} />
                      </Field>
                      <Field label="Batch no" error={e?.batchNo?.message}>
                        <Input {...register(`lines.${i}.batchNo`)} />
                      </Field>
                      <Field label="Mfg date" error={e?.mfgDate?.message}>
                        <Input type="date" {...register(`lines.${i}.mfgDate`)} />
                      </Field>
                      <Field label="Expiry date" error={e?.expiryDate?.message}>
                        <Input type="date" {...register(`lines.${i}.expiryDate`)} />
                      </Field>
                    </div>
                  </div>
                );
              })}
              {errors.root?.message && <p role="alert" className="text-xs text-red-600">{errors.root.message}</p>}
            </CardBody>
          </Card>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
          <Button variant="secondary" onClick={() => navigate(-1)} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!po}>Record receipt</Button>
        </div>
      </form>
    </>
  );
}
