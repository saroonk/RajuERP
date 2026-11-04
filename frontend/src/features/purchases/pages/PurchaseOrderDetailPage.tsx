import { Link, useNavigate, useParams } from 'react-router-dom';
import { DataTable, type Column } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { Menu } from '@/components/ui/Menu';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Loadable } from '@/components/ui/States';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { GoodsReceiptRow, PurchaseOrderRow } from '@/types';
import { formatCurrency, formatDate, formatNumber, formatPercent } from '@/utils/format';
import { Button } from '@/components/ui/Button';
import { usePOActions } from '../components/poActions';

export default function PurchaseOrderDetailPage() {
  const { id = '' } = useParams();
  const state = useData(() => services.purchases.orders.get(id), [id]);
  return <Loadable state={state}>{(po) => <Detail po={po} />}</Loadable>;
}

function Detail({ po }: { po: PurchaseOrderRow }) {
  const navigate = useNavigate();
  const lk = useLookups();
  const actions = usePOActions({ includeView: false, onDeleted: () => navigate('/purchases/orders') });
  const receipts = useData(() => services.purchases.receipts.list());
  const mine = receipts.data?.filter((g) => g.poId === po.id);
  const items = actions(po);

  const receiptCols: Column<GoodsReceiptRow>[] = [
    { key: 'grn', header: 'GRN no', value: (r) => r.grnNo, cell: (r) => <Link className="font-medium hover:underline" to={`/purchases/receipts/${r.id}`}>{r.grnNo}</Link>, primary: true },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date) },
    { key: 'inv', header: 'Supplier invoice', value: (r) => r.supplierInvoiceNo },
    { key: 'total', header: 'Total', align: 'right', value: (r) => r.total, cell: (r) => formatCurrency(r.total) },
  ];

  return (
    <>
      <PageHeader
        title={po.poNo}
        meta={<StatusBadge status={po.status} />}
        breadcrumbs={[{ label: 'Purchase orders', to: '/purchases/orders' }, { label: po.poNo }]}
        actions={
          <>
            {items.find((i) => i.label === 'Receive goods' && !i.hidden) && (
              <Button onClick={() => navigate(`/purchases/receipts/new?po=${po.id}`)}>Receive goods</Button>
            )}
            <Menu items={items.filter((i) => i.label !== 'Receive goods')} trigger={<span className="inline-flex h-10 items-center rounded-xl bg-white shadow-sm ring-1 ring-slate-900/10 px-3 text-sm font-medium md:h-9">More actions</span>} />
          </>
        }
      />
      <div className="space-y-4">
        <Card>
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Supplier', value: lk.supplier(po.supplierId)?.name ?? po.supplierName },
                { label: 'Supplier GSTIN', value: lk.supplier(po.supplierId)?.gstin || '—' },
                { label: 'Order date', value: formatDate(po.date) },
                { label: 'Expected delivery', value: formatDate(po.expectedDate) },
                { label: 'Received so far', value: formatPercent(po.receivedPct, 0) },
                { label: 'Notes', value: po.notes || '—' },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Order lines" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2.5">Product</th>
                  <th className="px-3 py-2.5 text-right">Ordered</th>
                  <th className="px-3 py-2.5 text-right">Received</th>
                  <th className="px-3 py-2.5 text-right">Pending</th>
                  <th className="px-3 py-2.5 text-right">Rate</th>
                  <th className="px-3 py-2.5 text-right">GST</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="tabular divide-y divide-neutral-100">
                {po.lines.map((l) => {
                  const p = po.lineProgress.find((x) => x.productId === l.productId);
                  return (
                    <tr key={l.productId}>
                      <td className="px-3 py-2.5">{lk.productName(l.productId)}</td>
                      <td className="px-3 py-2.5 text-right">{formatNumber(l.qty)}</td>
                      <td className="px-3 py-2.5 text-right">{formatNumber(p?.received ?? 0)}</td>
                      <td className="px-3 py-2.5 text-right">{formatNumber(p?.pending ?? l.qty)}</td>
                      <td className="px-3 py-2.5 text-right">{formatCurrency(l.rate)}</td>
                      <td className="px-3 py-2.5 text-right">{l.gstRate}%</td>
                      <td className="px-3 py-2.5 text-right">{formatCurrency(l.qty * l.rate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <dl className="tabular ml-auto w-full space-y-1 p-4 text-sm sm:max-w-xs">
            <div className="flex justify-between"><dt className="text-neutral-500">Taxable value</dt><dd>{formatCurrency(po.taxable)}</dd></div>
            <div className="flex justify-between"><dt className="text-neutral-500">GST</dt><dd>{formatCurrency(po.tax)}</dd></div>
            <div className="flex justify-between border-t border-neutral-200 pt-1 font-semibold"><dt>Total</dt><dd>{formatCurrency(po.total)}</dd></div>
          </dl>
        </Card>

        <div>
          <h2 className="mb-2 text-sm font-semibold">Goods receipts</h2>
          <DataTable data={mine} columns={receiptCols} rowKey={(r) => r.id} loading={receipts.loading} emptyTitle="Nothing received yet" emptyDescription="Goods receipts recorded against this order appear here." />
        </div>
      </div>
    </>
  );
}
