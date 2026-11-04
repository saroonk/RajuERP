import { Link, useNavigate, useParams } from 'react-router-dom';
import { FileText, Printer } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Confirm';
import { Loadable } from '@/components/ui/States';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { DispatchRow } from '@/types';
import { formatDate, formatNumber, today } from '@/utils/format';

export default function DispatchDetailPage() {
  const { id = '' } = useParams();
  const state = useData(() => services.distribution.dispatches.get(id), [id]);
  return <Loadable state={state}>{(d) => <Detail d={d} />}</Loadable>;
}

function Detail({ d }: { d: DispatchRow }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { run, busy } = useAction();
  const lookups = useLookups();
  const batches = useData(() => services.inventory.batchStock());
  const settings = useData(() => services.admin.settings());
  const distributor = lookups.distributor(d.distributorId);

  const generate = async () => {
    if (!(await confirm({ title: 'Generate invoice?', message: `An invoice dated today will be created for ${d.dispatchNo}.`, confirmLabel: 'Generate invoice' }))) return;
    const inv = await run(() => services.sales.invoices.createFromDispatch(d.id, today()), 'Invoice generated');
    if (inv) navigate(`/sales/invoices/${inv.id}`);
  };

  return (
    <>
      <PageHeader
        title={d.dispatchNo}
        meta={d.invoiceId ? <StatusBadge status="paid" label="Invoiced" /> : <StatusBadge status="unpaid" label="Not invoiced" />}
        breadcrumbs={[{ label: 'Dispatches', to: '/distribution/dispatches' }, { label: d.dispatchNo }]}
        actions={
          <>
            <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print delivery note</Button>
            {!d.invoiceId && can('sales', 'edit') && <Button icon={<FileText className="h-4 w-4" />} loading={busy} onClick={generate}>Generate invoice</Button>}
          </>
        }
      />
      <Card className="print-area">
        <div className="print-only px-4 pt-4">
          <p className="text-base font-semibold">{settings.data?.companyName} — Delivery note</p>
          <p className="text-xs">{settings.data?.address} · GSTIN {settings.data?.gstin}</p>
        </div>
        <CardHeader title="Dispatch details" />
        <CardBody className="space-y-5">
          <DescriptionList
            items={[
              { label: 'Dispatch date', value: formatDate(d.date) },
              { label: 'Order', value: <Link className="hover:underline" to={`/distribution/orders/${d.orderId}`}>{d.orderNo}</Link> },
              { label: 'Distributor', value: d.distributorName },
              { label: 'Deliver to', value: distributor ? `${distributor.address}, ${distributor.city}, ${distributor.state}` : '—' },
              { label: 'Vehicle no', value: d.vehicleNo || '—' },
              { label: 'Delivery document ref', value: d.deliveryRef || '—' },
              { label: 'Invoice', value: d.invoiceId ? <Link className="hover:underline" to={`/sales/invoices/${d.invoiceId}`}>{d.invoiceNo}</Link> : 'Not invoiced yet' },
              { label: 'Notes', value: d.notes || '—' },
            ]}
          />
          <div className="overflow-x-auto rounded-xl ring-1 ring-slate-900/[0.08]">
            <table className="w-full min-w-max text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Batch</th>
                  <th className="px-3 py-2">Expiry</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {d.lines.map((l, i) => {
                  const b = batches.data?.find((x) => x.id === l.batchId);
                  return (
                    <tr key={`${l.batchId}-${i}`}>
                      <td className="px-3 py-2">{i + 1}</td>
                      <td className="px-3 py-2">{lookups.productName(l.productId)}</td>
                      <td className="px-3 py-2">{b?.batchNo ?? l.batchId}</td>
                      <td className="px-3 py-2">{formatDate(b?.expiryDate)}</td>
                      <td className="tabular px-3 py-2 text-right">{formatNumber(l.qty)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-neutral-200 font-medium">
                  <td colSpan={4} className="px-3 py-2 text-right">Total</td>
                  <td className="tabular px-3 py-2 text-right">{formatNumber(d.totalQty)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="print-only grid grid-cols-2 gap-8 pt-10 text-xs">
            <div className="border-t border-neutral-400 pt-1">Dispatched by</div>
            <div className="border-t border-neutral-400 pt-1">Received by</div>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
