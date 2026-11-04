import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Confirm';
import { Field, Input, Select, Textarea } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/States';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { useLookups, type Lookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { DistributionOrderRow, DistributorBalance, DistributorPrice, ProductStock, Settings } from '@/types';
import { formatCurrency, formatNumber, today } from '@/utils/format';
import { computeDocumentTotals, computeLineTax } from '@/utils/gst';
import { dateField, numberField } from '@/utils/schemas';

const schema = z.object({
  distributorId: z.string().min(1, 'Select a distributor'),
  date: dateField('Order date', { notFuture: true }),
  expectedDate: z.string(),
  notes: z.string().max(250),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1, 'Select a product'),
        qty: numberField('Quantity', { int: true, positive: true }),
        rate: numberField('Rate', { positive: true }),
        discountPct: numberField('Discount', { min: 0, max: 100 }),
        gstRate: z.number(),
      }),
    )
    .min(1, 'Add at least one product')
    .superRefine((lines, ctx) => {
      const seen = new Set<string>();
      lines.forEach((l, i) => {
        if (l.productId && seen.has(l.productId)) ctx.addIssue({ code: 'custom', path: [i, 'productId'], message: 'Product already added' });
        seen.add(l.productId);
      });
    }),
});
type Values = z.infer<typeof schema>;

interface Ctx {
  lookups: Lookups;
  settings: Settings;
  stock: ProductStock[];
  prices: DistributorPrice[];
  balances: DistributorBalance[];
}

function OrderForm({ ctx, existing, presetDistributor }: { ctx: Ctx; existing?: DistributionOrderRow; presetDistributor: string }) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { run, busy } = useAction();
  const { lookups, settings, stock, prices, balances } = ctx;

  const { register, control, handleSubmit, watch, setValue, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: existing
      ? { distributorId: existing.distributorId, date: existing.date, expectedDate: existing.expectedDate ?? '', notes: existing.notes, lines: existing.lines }
      : { distributorId: presetDistributor, date: today(), expectedDate: '', notes: '', lines: [] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const distributorId = watch('distributorId');
  const lines = watch('lines');
  const distributor = lookups.distributor(distributorId);
  const interState = !!distributor && distributor.state !== settings.state;

  const priceFor = (productId: string, dId: string) => {
    const p = lookups.product(productId);
    const sp = prices.find((x) => x.distributorId === dId && x.productId === productId);
    return { rate: sp?.price ?? p?.sellingPrice ?? 0, discountPct: sp?.discountPct ?? 0, gstRate: p?.gstRate ?? 0 };
  };

  const onProduct = (i: number, productId: string) => {
    const p = priceFor(productId, distributorId);
    setValue(`lines.${i}.rate`, p.rate, { shouldValidate: true });
    setValue(`lines.${i}.discountPct`, p.discountPct);
    setValue(`lines.${i}.gstRate`, p.gstRate);
  };
  const onDistributor = (id: string) => {
    lines.forEach((l, i) => {
      if (!l.productId) return;
      const p = priceFor(l.productId, id);
      setValue(`lines.${i}.rate`, p.rate);
      setValue(`lines.${i}.discountPct`, p.discountPct);
    });
  };

  const valid = lines.filter((l) => l.productId && l.qty > 0 && l.rate > 0);
  const totals = useMemo(() => computeDocumentTotals(valid.map((l) => ({ qty: l.qty, rate: l.rate, discountPct: l.discountPct || 0, gstRate: l.gstRate })), interState, false), [valid, interState]);

  const bal = balances.find((b) => b.distributorId === distributorId);
  const projected = (bal?.balance ?? 0) + totals.subtotal;
  const overLimit = !!bal && bal.creditLimit > 0 && projected > bal.creditLimit;

  const save = (status: 'draft' | 'confirmed') =>
    handleSubmit(async (v) => {
      if (status === 'confirmed' && overLimit && !(await confirm({ title: 'Credit limit exceeded', message: `This order takes ${distributor?.name} to ${formatCurrency(projected)} against a limit of ${formatCurrency(bal!.creditLimit)}. Confirm anyway?`, confirmLabel: 'Confirm anyway', danger: true }))) return;
      const input = { distributorId: v.distributorId, date: v.date, expectedDate: v.expectedDate || null, notes: v.notes, lines: v.lines, status };
      const saved = await run(() => (existing ? services.distribution.orders.update(existing.id, input) : services.distribution.orders.create(input)), status === 'confirmed' ? 'Order confirmed' : 'Order saved as draft');
      if (saved) navigate(`/distribution/orders/${saved.id}`);
    });

  const stockOf = (productId: string) => stock.find((s) => s.productId === productId)?.available;

  return (
    <form noValidate className="space-y-4" onSubmit={(e) => e.preventDefault()}>
      <Card>
        <CardHeader title="Order details" />
        <CardBody className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Distributor / dealer" required error={errors.distributorId?.message} className="lg:col-span-2">
            <Select
              placeholder="Select…"
              options={lookups.distributors.filter((d) => d.active || d.id === distributorId).map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }))}
              {...register('distributorId', { onChange: (e) => onDistributor(e.target.value) })}
            />
          </Field>
          <Field label="Order date" required error={errors.date?.message}>
            <Input type="date" max={today()} {...register('date')} />
          </Field>
          <Field label="Expected delivery" error={errors.expectedDate?.message}>
            <Input type="date" {...register('expectedDate')} />
          </Field>
          <Field label="Notes" className="sm:col-span-2 lg:col-span-4">
            <Textarea rows={2} {...register('notes')} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Products" description="Rates and discounts follow the distributor's special pricing when one is set." action={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => append({ productId: '', qty: 12, rate: 0, discountPct: 0, gstRate: 0 })} disabled={!distributorId}>Add product</Button>} />
        <CardBody className="space-y-3">
          {!distributorId && <p className="text-sm text-neutral-500">Select a distributor first.</p>}
          {typeof errors.lines?.message === 'string' && <p role="alert" className="text-xs text-red-600">{errors.lines.message}</p>}
          {errors.lines?.root?.message && <p role="alert" className="text-xs text-red-600">{errors.lines.root.message}</p>}
          {fields.map((f, i) => {
            const l = lines[i];
            const t = l ? computeLineTax({ qty: l.qty || 0, rate: l.rate || 0, discountPct: l.discountPct || 0, gstRate: l.gstRate }, interState) : null;
            const avail = l?.productId ? stockOf(l.productId) : undefined;
            const short = avail !== undefined && l.qty > avail;
            const e = errors.lines?.[i];
            const p = lookups.product(l?.productId);
            return (
              <div key={f.id} className="rounded-xl bg-slate-50/70 p-3.5 ring-1 ring-slate-900/[0.05]">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                  <Field label="Product" error={e?.productId?.message} className="col-span-2 sm:col-span-3">
                    <Select placeholder="Select product…" options={lookups.products.filter((x) => x.active).map((x) => ({ value: x.id, label: `${x.name} (${x.sku})` }))} {...register(`lines.${i}.productId`, { onChange: (ev) => onProduct(i, ev.target.value) })} />
                  </Field>
                  <Field label={`Qty${p ? ` (${lookups.unit(p.unitId)?.code ?? ''})` : ''}`} error={e?.qty?.message}>
                    <Input type="number" inputMode="numeric" min={1} step={1} {...register(`lines.${i}.qty`, { valueAsNumber: true })} />
                  </Field>
                  <Field label="Rate (₹)" error={e?.rate?.message}>
                    <Input type="number" inputMode="decimal" step="any" {...register(`lines.${i}.rate`, { valueAsNumber: true })} />
                  </Field>
                  <Field label="Disc %" error={e?.discountPct?.message}>
                    <Input type="number" inputMode="decimal" step="any" {...register(`lines.${i}.discountPct`, { valueAsNumber: true })} />
                  </Field>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
                  <span>
                    GST {l?.gstRate ?? 0}%{avail !== undefined && <> · Available stock: <span className={short ? 'font-medium text-amber-700' : ''}>{formatNumber(avail)}</span></>}
                    {short && <span className="ml-1 inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3 w-3" />Quantity exceeds available stock</span>}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="tabular text-sm font-medium text-neutral-900">{t ? formatCurrency(t.total) : '—'}</span>
                    <button type="button" onClick={() => remove(i)} className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-red-600" aria-label="Remove line"><Trash2 className="h-4 w-4" /></button>
                  </span>
                </div>
              </div>
            );
          })}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Credit check" />
          <CardBody className="space-y-1.5 text-sm">
            {bal ? (
              <>
                <Row label="Current outstanding" value={formatCurrency(bal.balance)} />
                <Row label="This order (incl. GST)" value={formatCurrency(totals.subtotal)} />
                <Row label="Projected outstanding" value={formatCurrency(projected)} strong />
                <Row label="Credit limit" value={formatCurrency(bal.creditLimit)} />
                {overLimit && (
                  <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    This order exceeds the credit limit by {formatCurrency(projected - bal.creditLimit)}. You can still save it; confirming asks for approval.
                  </p>
                )}
              </>
            ) : (
              <p className="text-neutral-500">Select a distributor to see credit exposure.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Totals" description={distributor ? (interState ? `Inter-state supply (${distributor.state}) — IGST applies` : 'Intra-state supply — CGST + SGST apply') : undefined} />
          <CardBody className="space-y-1.5 text-sm">
            <Row label="Taxable value" value={formatCurrency(totals.taxable)} />
            {interState ? <Row label="IGST" value={formatCurrency(totals.igst)} /> : (<><Row label="CGST" value={formatCurrency(totals.cgst)} /><Row label="SGST" value={formatCurrency(totals.sgst)} /></>)}
            <Row label="Order total" value={formatCurrency(totals.subtotal)} strong />
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => navigate(-1)} disabled={busy}>Cancel</Button>
        <Button variant="secondary" loading={busy} onClick={save('draft')}>Save as draft</Button>
        <Button loading={busy} onClick={save('confirmed')}>Save &amp; confirm</Button>
      </div>
    </form>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'border-t border-neutral-200 pt-1.5 font-semibold' : ''}`}>
      <span className="text-neutral-500">{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}

export default function OrderFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const lookups = useLookups();
  const order = useData(() => (id ? services.distribution.orders.get(id) : Promise.resolve(undefined)), [id]);
  const settings = useData(() => services.admin.settings());
  const stock = useData(() => services.inventory.stockByProduct());
  const prices = useData(() => services.distributorPrices.list());
  const balances = useData(() => services.accounts.balances());

  const ready = !lookups.loading && !order.loading && settings.data && stock.data && prices.data && balances.data;
  const blocked = order.data && (order.data.hasDispatches || !['draft', 'confirmed'].includes(order.data.status));

  return (
    <>
      <PageHeader title={id ? 'Edit order' : 'New order'} breadcrumbs={[{ label: 'Orders', to: '/distribution/orders' }, { label: id ? (order.data?.orderNo ?? 'Edit') : 'New' }]} />
      {!ready ? (
        <Spinner />
      ) : id && !order.data ? (
        <p className="text-sm text-neutral-500">Order not found.</p>
      ) : blocked ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This order has dispatches or is no longer open, so it can’t be edited.</p>
      ) : (
        <OrderForm ctx={{ lookups, settings: settings.data!, stock: stock.data!, prices: prices.data!, balances: balances.data! }} existing={order.data} presetDistributor={params.get('distributor') ?? ''} />
      )}
    </>
  );
}
