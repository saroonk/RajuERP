import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Info, Plus, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/States';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { DistributionOrderRow } from '@/types';
import { formatDate, formatNumber, today } from '@/utils/format';

interface AllocRow {
  key: number;
  batchId: string;
  qty: string;
}
let rowKey = 0;
const newRow = (batchId = '', qty = ''): AllocRow => ({ key: ++rowKey, batchId, qty });

export default function DispatchFormPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const lookups = useLookups();
  const orders = useData(() => services.distribution.orders.list());
  const [orderId, setOrderId] = useState(params.get('order') ?? '');
  const [date, setDate] = useState(today());
  const [vehicleNo, setVehicleNo] = useState('');
  const [deliveryRef, setDeliveryRef] = useState('');
  const [notes, setNotes] = useState('');
  const [invoiceAfter, setInvoiceAfter] = useState(true);
  const [alloc, setAlloc] = useState<Record<string, AllocRow[]>>({});
  const [submitted, setSubmitted] = useState(false);

  const open = useMemo(() => orders.data?.filter((o) => ['confirmed', 'partially_dispatched'].includes(o.status)) ?? [], [orders.data]);
  const order: DistributionOrderRow | undefined = open.find((o) => o.id === orderId);
  const pendingLines = useMemo(() => order?.lineProgress.filter((l) => l.pending > 0) ?? [], [order]);
  const productKey = pendingLines.map((l) => l.productId).join(',');

  const batches = useData(
    async () => {
      const entries = await Promise.all(pendingLines.map(async (l) => [l.productId, await services.inventory.dispatchableBatches(l.productId, date)] as const));
      return Object.fromEntries(entries);
    },
    [productKey, date],
  );

  const pickOrder = (id: string) => {
    setOrderId(id);
    setAlloc({});
    setSubmitted(false);
  };

  const setRows = (productId: string, rows: AllocRow[]) => setAlloc((a) => ({ ...a, [productId]: rows }));
  const autoAllocate = async (productId: string, pending: number) => {
    const s = await services.inventory.suggestAllocation(productId, pending, date);
    setRows(productId, s.map((x) => newRow(x.batchId, String(x.qty))));
    return s.reduce((t, x) => t + x.qty, 0);
  };
  const autoAll = async () => {
    for (const l of pendingLines) await autoAllocate(l.productId, l.pending);
  };

  /* validation */
  const errors = useMemo(() => {
    const out: Record<string, string[]> = {};
    const perBatch = new Map<string, number>();
    for (const l of pendingLines) {
      const rows = alloc[l.productId] ?? [];
      const errs: string[] = [];
      let sum = 0;
      for (const r of rows) {
        const q = Number(r.qty);
        if (!r.batchId && !r.qty) continue;
        if (!r.batchId) errs.push('Choose a batch for each row with a quantity');
        else if (!Number.isInteger(q) || q <= 0) errs.push('Quantities must be whole numbers greater than zero');
        else {
          sum += q;
          perBatch.set(r.batchId, (perBatch.get(r.batchId) ?? 0) + q);
        }
      }
      if (sum > l.pending) errs.push(`Allocated ${formatNumber(sum)} exceeds pending ${formatNumber(l.pending)}`);
      for (const [bid, q] of perBatch) {
        const b = batches.data?.[l.productId]?.find((x) => x.id === bid);
        if (b && q > b.available) errs.push(`Batch ${b.batchNo} has only ${formatNumber(b.available)} available`);
      }
      out[l.productId] = [...new Set(errs)];
    }
    return out;
  }, [alloc, pendingLines, batches.data]);

  const lines = pendingLines.flatMap((l) => (alloc[l.productId] ?? []).filter((r) => r.batchId && Number(r.qty) > 0).map((r) => ({ productId: l.productId, batchId: r.batchId, qty: Number(r.qty) })));
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  const hasErrors = Object.values(errors).some((e) => e.length);

  const submit = async () => {
    setSubmitted(true);
    if (!order || hasErrors || lines.length === 0 || !date || date > today()) return;
    const disp = await run(() => services.distribution.dispatches.create({ orderId: order.id, date, vehicleNo, deliveryRef, notes, lines }), 'Dispatch recorded');
    if (!disp) return;
    if (invoiceAfter) {
      const inv = await run(() => services.sales.invoices.createFromDispatch(disp.id, date), 'Invoice generated');
      navigate(inv ? `/sales/invoices/${inv.id}` : `/distribution/dispatches/${disp.id}`);
    } else navigate(`/distribution/dispatches/${disp.id}`);
  };

  return (
    <>
      <PageHeader title="New dispatch" breadcrumbs={[{ label: 'Dispatches', to: '/distribution/dispatches' }, { label: 'New' }]} />
      {orders.loading || lookups.loading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <p className="flex items-start gap-2 rounded-xl bg-accent-50/70 p-3.5 text-xs text-neutral-600 ring-1 ring-accent-100">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Dispatching reduces saleable stock of the chosen batches. Dispatched quantity is what you sent — it is not treated as sold by the distributor until they report sales.
          </p>
          <Card>
            <CardHeader title="Dispatch details" />
            <CardBody className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Order" required className="lg:col-span-2" error={submitted && !order ? 'Select an order to dispatch' : undefined}>
                <Select value={orderId} onChange={(e) => pickOrder(e.target.value)} placeholder="Select confirmed order…" options={open.map((o) => ({ value: o.id, label: `${o.orderNo} — ${o.distributorName}` }))} />
              </Field>
              <Field label="Dispatch date" required error={date > today() ? 'Dispatch date cannot be in the future' : submitted && !date ? 'Required' : undefined}>
                <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Vehicle no">
                <Input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="KA-01-AB-1234" />
              </Field>
              <Field label="Delivery document ref">
                <Input value={deliveryRef} onChange={(e) => setDeliveryRef(e.target.value)} placeholder="Challan / LR number" />
              </Field>
              <Field label="Notes" className="sm:col-span-2">
                <Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </CardBody>
          </Card>

          {order && pendingLines.length === 0 && <p className="text-sm text-neutral-500">Everything on this order is already dispatched.</p>}

          {order && pendingLines.length > 0 && (
            <Card>
              <CardHeader
                title={`Batch allocation — ${order.distributorName}`}
                description="Allocate batches for each pending line. Earliest-expiry batches are suggested first."
                action={<Button size="sm" variant="secondary" icon={<Wand2 className="h-4 w-4" />} onClick={autoAll}>Auto-allocate all</Button>}
              />
              <CardBody className="space-y-4">
                {pendingLines.map((l) => {
                  const rows = alloc[l.productId] ?? [];
                  const options = batches.data?.[l.productId] ?? [];
                  const allocated = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
                  return (
                    <div key={l.productId} className="rounded-xl bg-slate-50/70 p-3.5 ring-1 ring-slate-900/[0.05]">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{lookups.productName(l.productId)}</p>
                          <p className="text-xs text-neutral-500">Ordered {formatNumber(l.ordered)} · Dispatched {formatNumber(l.dispatched)} · <span className="font-medium text-amber-700">Pending {formatNumber(l.pending)}</span> · Allocating {formatNumber(allocated)}</p>
                        </div>
                        <Button size="sm" variant="ghost" icon={<Wand2 className="h-3.5 w-3.5" />} onClick={() => autoAllocate(l.productId, l.pending)}>Auto-allocate</Button>
                      </div>
                      {options.length === 0 && !batches.loading && <p className="mt-2 text-xs text-red-600">No saleable, unexpired stock available for this product on {formatDate(date)}.</p>}
                      <div className="mt-3 space-y-2">
                        {rows.map((r) => (
                          <div key={r.key} className="grid grid-cols-[1fr_6rem_auto] items-end gap-2">
                            <Field label="Batch">
                              <Select
                                value={r.batchId}
                                placeholder="Select batch…"
                                onChange={(e) => setRows(l.productId, rows.map((x) => (x.key === r.key ? { ...x, batchId: e.target.value } : x)))}
                                options={options.map((b) => ({ value: b.id, label: `${b.batchNo} · exp ${formatDate(b.expiryDate)} · ${formatNumber(b.available)} avail` }))}
                              />
                            </Field>
                            <Field label="Qty">
                              <Input type="number" inputMode="numeric" min={1} value={r.qty} onChange={(e) => setRows(l.productId, rows.map((x) => (x.key === r.key ? { ...x, qty: e.target.value } : x)))} />
                            </Field>
                            <button type="button" aria-label="Remove batch row" onClick={() => setRows(l.productId, rows.filter((x) => x.key !== r.key))} className="mb-0.5 rounded-md p-2 text-neutral-500 hover:bg-neutral-100 hover:text-red-600">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <Button size="sm" variant="secondary" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRows(l.productId, [...rows, newRow()])}>Add batch</Button>
                      {errors[l.productId]?.map((e) => <p key={e} role="alert" className="mt-2 text-xs text-red-600">{e}</p>)}
                    </div>
                  );
                })}
              </CardBody>
            </Card>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Checkbox label="Generate invoice after dispatch" checked={invoiceAfter} onChange={(e) => setInvoiceAfter(e.target.checked)} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              {submitted && lines.length === 0 && order && <span role="alert" className="text-xs text-red-600">Allocate at least one batch</span>}
              <span className="text-xs text-neutral-500">Total to dispatch: {formatNumber(totalQty)}</span>
              <Button variant="secondary" onClick={() => navigate(-1)} disabled={busy}>Cancel</Button>
              <Button loading={busy} onClick={submit} disabled={!order}>Record dispatch</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
