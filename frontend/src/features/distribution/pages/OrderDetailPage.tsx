import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Pencil, Trash2, Truck, XCircle } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { Button, LinkButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { Loadable } from '@/components/ui/States';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/data/DataTable';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { DispatchRow, DistributionOrderRow } from '@/types';
import { formatCurrency, formatDate, formatNumber, formatPercent } from '@/utils/format';
import { computeLineTax } from '@/utils/gst';
import { useOrderActions } from '../components/useOrderActions';

export default function OrderDetailPage() {
  const { id = '' } = useParams();
  const state = useData(() => services.distribution.orders.get(id), [id]);
  return (
    <Loadable state={state}>
      {(o) => <Detail order={o} />}
    </Loadable>
  );
}

function Detail({ order: o }: { order: DistributionOrderRow }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const lookups = useLookups();
  const actions = useOrderActions();
  const dispatches = useData(() => services.distribution.dispatches.list());
  const settings = useData(() => services.admin.settings());
  const canEdit = can('distribution', 'edit');
  const mine = dispatches.data?.filter((d) => d.orderId === o.id);
  const distributor = lookups.distributor(o.distributorId);
  const interState = !!distributor && !!settings.data && distributor.state !== settings.data.state;

  const lineCols = o.lines.map((l) => {
    const prog = o.lineProgress.find((p) => p.productId === l.productId)!;
    return { ...l, ...prog, tax: computeLineTax({ qty: l.qty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate }, interState) };
  });
  type Line = (typeof lineCols)[number];
  const columns: Column<Line>[] = [
    { key: 'product', header: 'Product', primary: true, value: (r) => lookups.productName(r.productId), cell: (r) => <span className="font-medium">{lookups.productName(r.productId)}</span> },
    { key: 'ordered', header: 'Ordered', align: 'right', value: (r) => r.ordered, cell: (r) => formatNumber(r.ordered) },
    { key: 'dispatched', header: 'Dispatched', align: 'right', value: (r) => r.dispatched, cell: (r) => formatNumber(r.dispatched) },
    { key: 'pending', header: 'Pending', align: 'right', value: (r) => r.pending, cell: (r) => <span className={r.pending > 0 ? 'font-medium text-amber-700' : ''}>{formatNumber(r.pending)}</span> },
    { key: 'rate', header: 'Rate', align: 'right', value: (r) => r.rate, cell: (r) => formatCurrency(r.rate) },
    { key: 'disc', header: 'Disc %', align: 'right', value: (r) => r.discountPct, cell: (r) => formatPercent(r.discountPct) },
    { key: 'gst', header: 'GST %', align: 'right', value: (r) => r.gstRate, cell: (r) => formatPercent(r.gstRate, 0) },
    { key: 'total', header: 'Amount', align: 'right', value: (r) => r.tax.total, cell: (r) => formatCurrency(r.tax.total) },
  ];
  const dispCols: Column<DispatchRow>[] = [
    { key: 'no', header: 'Dispatch', primary: true, value: (r) => r.dispatchNo, cell: (r) => <Link className="font-medium hover:underline" to={`/distribution/dispatches/${r.id}`}>{r.dispatchNo}</Link> },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date) },
    { key: 'qty', header: 'Qty', align: 'right', value: (r) => r.totalQty, cell: (r) => formatNumber(r.totalQty) },
    { key: 'inv', header: 'Invoice', cell: (r) => (r.invoiceId ? <Link className="hover:underline" to={`/sales/invoices/${r.invoiceId}`}>{r.invoiceNo}</Link> : <StatusBadge status="unpaid" label="Not invoiced" />) },
  ];

  const open = ['draft', 'confirmed'].includes(o.status);
  const cgst = o.lines.reduce((s, l) => s + computeLineTax(l, interState).cgst, 0);
  const sgst = o.lines.reduce((s, l) => s + computeLineTax(l, interState).sgst, 0);
  const igst = o.lines.reduce((s, l) => s + computeLineTax(l, interState).igst, 0);

  return (
    <>
      <PageHeader
        title={o.orderNo}
        meta={<StatusBadge status={o.status} />}
        breadcrumbs={[{ label: 'Orders', to: '/distribution/orders' }, { label: o.orderNo }]}
        actions={
          canEdit && (
            <>
              {open && !o.hasDispatches && <LinkButton variant="secondary" to={`/distribution/orders/${o.id}/edit`} icon={<Pencil className="h-4 w-4" />}>Edit</LinkButton>}
              {o.status === 'draft' && <Button icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => actions.confirmOrder(o)}>Confirm</Button>}
              {['confirmed', 'partially_dispatched'].includes(o.status) && <LinkButton to={`/distribution/dispatches/new?order=${o.id}`} icon={<Truck className="h-4 w-4" />}>Dispatch</LinkButton>}
              {open && !o.hasDispatches && <Button variant="secondary" icon={<XCircle className="h-4 w-4" />} onClick={() => actions.cancelOrder(o)}>Cancel</Button>}
              {['draft', 'cancelled'].includes(o.status) && (
                <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={async () => (await actions.deleteOrder(o)) && navigate('/distribution/orders')}>Delete</Button>
              )}
            </>
          )
        }
      />
      <div className="space-y-4">
        <Card>
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Distributor', value: distributor ? <Link className="hover:underline" to={`/distribution/distributors/${distributor.id}`}>{o.distributorName}</Link> : o.distributorName },
                { label: 'Order date', value: formatDate(o.date) },
                { label: 'Expected delivery', value: formatDate(o.expectedDate) },
                { label: 'Dispatched', value: formatPercent(o.dispatchedPct, 0) },
                { label: 'Supply type', value: interState ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)' },
                { label: 'Notes', value: o.notes || '—' },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Order lines" />
          <DataTable data={lineCols} columns={columns} rowKey={(r) => r.productId} className="rounded-none border-0 shadow-none" pageSize={25} />
          <div className="ml-auto w-full max-w-xs space-y-1 border-t border-neutral-200 p-4 text-sm">
            <Sum label="Taxable value" value={o.taxable} />
            {interState ? <Sum label="IGST" value={igst} /> : (<><Sum label="CGST" value={cgst} /><Sum label="SGST" value={sgst} /></>)}
            <Sum label="Order total" value={o.total} strong />
          </div>
        </Card>
        <Card>
          <CardHeader title="Dispatches" description="Dispatched quantities reduce batch stock; they are not distributor sales." />
          <DataTable data={mine} columns={dispCols} rowKey={(r) => r.id} loading={dispatches.loading} emptyTitle="Nothing dispatched yet" className="rounded-none border-0 shadow-none" />
        </Card>
      </div>
    </>
  );
}

function Sum({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'border-t border-neutral-200 pt-1 font-semibold' : ''}`}>
      <span className="text-neutral-500">{label}</span>
      <span className="tabular">{formatCurrency(value)}</span>
    </div>
  );
}
