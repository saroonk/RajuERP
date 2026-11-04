import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { Loadable } from '@/components/ui/States';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { POInput } from '@/services/types';
import type { PurchaseOrderRow } from '@/types';
import { formatCurrency, today } from '@/utils/format';
import { GST_RATES, computePurchaseTotals } from '@/utils/gst';
import { dateField, numberField, requiredText } from '@/utils/schemas';

const schema = z.object({
  supplierId: requiredText('Supplier'),
  date: dateField('Order date'),
  expectedDate: z.string(),
  notes: z.string().max(500),
  lines: z
    .array(
      z.object({
        productId: requiredText('Product'),
        qty: numberField('Quantity', { positive: true, int: true }),
        rate: numberField('Rate', { positive: true }),
        gstRate: numberField('GST rate', { min: 0, max: 28 }),
      }),
    )
    .min(1, 'Add at least one product'),
});
type Values = z.infer<typeof schema>;

export default function PurchaseOrderFormPage() {
  const { id } = useParams();
  const existing = useData(() => (id ? services.purchases.orders.get(id) : Promise.resolve(undefined)), [id]);
  if (!id) return <PurchaseOrderForm />;
  return <Loadable state={existing}>{(po) => <PurchaseOrderForm po={po} />}</Loadable>;
}

function PurchaseOrderForm({ po }: { po?: PurchaseOrderRow }) {
  const navigate = useNavigate();
  const lk = useLookups();
  const { run, busy } = useAction();
  const { register, control, handleSubmit, setValue, watch, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: po
      ? { supplierId: po.supplierId, date: po.date, expectedDate: po.expectedDate ?? '', notes: po.notes, lines: po.lines.map((l) => ({ ...l })) }
      : { supplierId: '', date: today(), expectedDate: '', notes: '', lines: [{ productId: '', qty: 0, rate: 0, gstRate: 0 }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const lines = watch('lines');
  const { errors } = formState;

  // Product options are only known after lookups load; keep selected values stable.
  useEffect(() => {
    if (!po || !lk.products.length) return;
    setValue('supplierId', po.supplierId);
    po.lines.forEach((l, i) => setValue(`lines.${i}.productId`, l.productId));
  }, [po, lk.products.length, setValue]);

  const totals = computePurchaseTotals(lines.map((l) => ({ qty: Number(l.qty) || 0, rate: Number(l.rate) || 0, gstRate: Number(l.gstRate) || 0 })));
  const used = new Set(lines.map((l) => l.productId));

  const save = (status: POInput['status']) =>
    handleSubmit(async (v) => {
      const input: POInput = { supplierId: v.supplierId, date: v.date, expectedDate: v.expectedDate || null, notes: v.notes, lines: v.lines, status };
      const saved = await run(
        () => (po ? services.purchases.orders.update(po.id, input) : services.purchases.orders.create(input)),
        status === 'ordered' ? 'Purchase order saved and marked as ordered' : 'Purchase order saved as draft',
      );
      if (saved) navigate(`/purchases/orders/${saved.id}`);
    });

  return (
    <>
      <PageHeader
        title={po ? `Edit ${po.poNo}` : 'New purchase order'}
        breadcrumbs={[{ label: 'Purchase orders', to: '/purchases/orders' }, { label: po ? po.poNo : 'New' }]}
      />
      <form onSubmit={save('ordered')} noValidate className="space-y-4">
        <Card>
          <CardHeader title="Order details" />
          <CardBody className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <Field label="Supplier" required error={errors.supplierId?.message} className="sm:col-span-3">
              <Select placeholder="Select supplier…" options={lk.suppliers.filter((s) => s.active || s.id === po?.supplierId).map((s) => ({ value: s.id, label: s.name }))} {...register('supplierId')} />
            </Field>
            <Field label="Order date" required error={errors.date?.message}>
              <Input type="date" {...register('date')} />
            </Field>
            <Field label="Expected delivery" error={errors.expectedDate?.message}>
              <Input type="date" {...register('expectedDate')} />
            </Field>
            <Field label="Notes" className="sm:col-span-3" error={errors.notes?.message}>
              <Textarea rows={2} {...register('notes')} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Products" description="Rates default to the product's purchase price." />
          <CardBody className="space-y-3">
            {fields.map((f, i) => {
              const line = lines[i];
              const amount = (Number(line?.qty) || 0) * (Number(line?.rate) || 0);
              const e = errors.lines?.[i];
              return (
                <div key={f.id} className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50/70 p-3.5 ring-1 ring-slate-900/[0.05] sm:grid-cols-12">
                  <Field label="Product" required error={e?.productId?.message} className="col-span-2 sm:col-span-5">
                    <Select
                      placeholder="Select product…"
                      options={lk.products.filter((p) => p.active || p.id === line?.productId).map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))}
                      {...register(`lines.${i}.productId`, {
                        onChange: (ev) => {
                          const p = lk.product(ev.target.value);
                          if (p) {
                            setValue(`lines.${i}.rate`, p.purchasePrice);
                            setValue(`lines.${i}.gstRate`, p.gstRate);
                          }
                        },
                      })}
                    >
                      {null}
                    </Select>
                  </Field>
                  <Field label="Quantity" required error={e?.qty?.message} className="sm:col-span-2">
                    <Input type="number" inputMode="numeric" min={1} step={1} {...register(`lines.${i}.qty`, { valueAsNumber: true })} />
                  </Field>
                  <Field label="Rate (₹)" required error={e?.rate?.message} className="sm:col-span-2">
                    <Input type="number" inputMode="decimal" step="any" {...register(`lines.${i}.rate`, { valueAsNumber: true })} />
                  </Field>
                  <Field label="GST %" required error={e?.gstRate?.message} className="sm:col-span-2">
                    <Select options={GST_RATES.map((r) => ({ value: String(r), label: `${r}%` }))} {...register(`lines.${i}.gstRate`, { valueAsNumber: true })} />
                  </Field>
                  <div className="col-span-2 flex items-end justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-end sm:justify-end">
                    <span className="tabular text-xs text-neutral-500 sm:hidden">Amount</span>
                    <span className="tabular text-sm font-medium">{formatCurrency(amount)}</span>
                    <Button variant="ghost" size="sm" onClick={() => remove(i)} disabled={fields.length === 1} aria-label={`Remove line ${i + 1}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
            {errors.lines?.message && <p role="alert" className="text-xs text-red-600">{errors.lines.message}</p>}
            {errors.lines?.root?.message && <p role="alert" className="text-xs text-red-600">{errors.lines.root.message}</p>}
            <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => append({ productId: '', qty: 0, rate: 0, gstRate: 0 })} disabled={used.size >= lk.products.length && lk.products.length > 0}>
              Add product
            </Button>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <dl className="tabular w-full space-y-1 surface p-5 text-sm sm:ml-auto sm:max-w-xs sm:order-2">
            <div className="flex justify-between"><dt className="text-neutral-500">Taxable value</dt><dd>{formatCurrency(totals.taxable)}</dd></div>
            <div className="flex justify-between"><dt className="text-neutral-500">GST</dt><dd>{formatCurrency(totals.tax)}</dd></div>
            <div className="flex justify-between border-t border-neutral-200 pt-1 font-semibold"><dt>Total</dt><dd>{formatCurrency(totals.total)}</dd></div>
          </dl>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:order-1 [&>*]:w-full sm:[&>*]:w-auto">
            <Button variant="secondary" onClick={() => navigate(-1)} disabled={busy}>Cancel</Button>
            <Button variant="secondary" loading={busy} onClick={save('draft')}>Save as draft</Button>
            <Button type="submit" loading={busy}>Save &amp; mark ordered</Button>
          </div>
        </div>
      </form>
    </>
  );
}
