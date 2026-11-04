import { Link, useParams } from 'react-router-dom';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Loadable } from '@/components/ui/States';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { GoodsReceiptRow } from '@/types';
import { formatCurrency, formatDate, formatNumber } from '@/utils/format';

export default function GoodsReceiptDetailPage() {
  const { id = '' } = useParams();
  const state = useData(() => services.purchases.receipts.get(id), [id]);
  return <Loadable state={state}>{(g) => <Detail g={g} />}</Loadable>;
}

function Detail({ g }: { g: GoodsReceiptRow }) {
  const lk = useLookups();
  return (
    <>
      <PageHeader
        title={g.grnNo}
        breadcrumbs={[{ label: 'Goods receipts', to: '/purchases/receipts' }, { label: g.grnNo }]}
        actions={<LinkButton variant="secondary" to="/inventory/batches">View batches</LinkButton>}
      />
      <div className="space-y-4">
        <Card>
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Supplier', value: g.supplierName },
                { label: 'Purchase order', value: <Link className="underline" to={`/purchases/orders/${g.poId}`}>{g.poNo}</Link> },
                { label: 'Receipt date', value: formatDate(g.date) },
                { label: 'Supplier invoice no', value: g.supplierInvoiceNo || '—' },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Received lines" description="Each line created or topped up one batch of saleable stock." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2.5">Product</th>
                  <th className="px-3 py-2.5">Batch</th>
                  <th className="px-3 py-2.5">Mfg</th>
                  <th className="px-3 py-2.5">Expiry</th>
                  <th className="px-3 py-2.5 text-right">Qty</th>
                  <th className="px-3 py-2.5 text-right">Rate</th>
                  <th className="px-3 py-2.5 text-right">GST</th>
                  <th className="px-3 py-2.5 text-right">Line total</th>
                </tr>
              </thead>
              <tbody className="tabular divide-y divide-neutral-100">
                {g.lines.map((l) => (
                  <tr key={l.batchId + l.productId}>
                    <td className="px-3 py-2.5">{lk.productName(l.productId)}</td>
                    <td className="px-3 py-2.5">{l.batchNo}</td>
                    <td className="px-3 py-2.5">{formatDate(l.mfgDate)}</td>
                    <td className="px-3 py-2.5">{formatDate(l.expiryDate)}</td>
                    <td className="px-3 py-2.5 text-right">{formatNumber(l.qty)}</td>
                    <td className="px-3 py-2.5 text-right">{formatCurrency(l.rate)}</td>
                    <td className="px-3 py-2.5 text-right">{l.gstRate}%</td>
                    <td className="px-3 py-2.5 text-right">{formatCurrency(l.qty * l.rate * (1 + l.gstRate / 100))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="tabular ml-auto w-full space-y-1 p-4 text-sm sm:max-w-xs">
            <div className="flex justify-between"><dt className="text-neutral-500">Taxable value</dt><dd>{formatCurrency(g.taxable)}</dd></div>
            <div className="flex justify-between"><dt className="text-neutral-500">GST</dt><dd>{formatCurrency(g.tax)}</dd></div>
            <div className="flex justify-between border-t border-neutral-200 pt-1 font-semibold"><dt>Total payable</dt><dd>{formatCurrency(g.total)}</dd></div>
          </dl>
        </Card>
      </div>
    </>
  );
}
