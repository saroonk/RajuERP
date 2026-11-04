import { useMemo, useState } from 'react';
import { Eye, Undo2 } from 'lucide-react';
import { Can } from '@/app/AuthContext';
import { DataTable, type Column } from '@/components/data/DataTable';
import { LinkButton } from '@/components/ui/Button';
import { FilterSelect } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/Badge';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { SupplierReturnRow } from '@/types';
import { formatCurrency, formatDate, formatNumber } from '@/utils/format';

export default function SupplierReturnsPage() {
  const returns = useData(() => services.purchases.returns.list());
  const batches = useData(() => services.inventory.batchStock());
  const lk = useLookups();
  const [supplier, setSupplier] = useState('');
  const [view, setView] = useState<SupplierReturnRow | null>(null);
  const rows = useMemo(() => returns.data?.filter((r) => !supplier || r.supplierId === supplier), [returns.data, supplier]);
  const batchNo = (id: string) => batches.data?.find((b) => b.id === id)?.batchNo ?? id;

  const columns: Column<SupplierReturnRow>[] = [
    { key: 'no', header: 'Return no', value: (r) => r.returnNo, primary: true },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date), csv: (r) => r.date },
    { key: 'supplier', header: 'Supplier', value: (r) => r.supplierName },
    { key: 'reason', header: 'Reason', value: (r) => r.reason },
    { key: 'qty', header: 'Qty', align: 'right', value: (r) => r.lines.reduce((s, l) => s + l.qty, 0), cell: (r) => `${formatNumber(r.lines.reduce((s, l) => s + l.qty, 0))} (${r.lines.length} lines)` },
    { key: 'taxable', header: 'Taxable', align: 'right', value: (r) => r.taxable, cell: (r) => formatCurrency(r.taxable) },
    { key: 'tax', header: 'GST', align: 'right', value: (r) => r.tax, cell: (r) => formatCurrency(r.tax) },
    { key: 'total', header: 'Total credit', align: 'right', value: (r) => r.total, cell: (r) => formatCurrency(r.total) },
  ];

  return (
    <>
      <PageHeader
        title="Supplier returns"
        description="Goods returned to suppliers. Stock and the supplier balance are reduced."
        actions={
          <Can module="purchases">
            <LinkButton to="/purchases/returns/new" icon={<Undo2 className="h-4 w-4" />}>
              New supplier return
            </LinkButton>
          </Can>
        }
      />
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={returns.loading}
        error={returns.error}
        onRetry={returns.reload}
        searchText={(r) => `${r.returnNo} ${r.supplierName} ${r.reason}`}
        exportName="supplier-returns"
        defaultSort={{ key: 'date', dir: 'desc' }}
        onRowClick={setView}
        rowActions={(r) => [{ label: 'View', icon: <Eye className="h-4 w-4" />, onClick: () => setView(r) }]}
        emptyTitle="No supplier returns"
        emptyDescription="Return damaged, expired or short-dated goods to a supplier."
        filters={<FilterSelect value={supplier} onChange={setSupplier} options={lk.suppliers.map((s) => ({ value: s.id, label: s.name }))} allLabel="All suppliers" />}
      />
      <Modal open={!!view} onClose={() => setView(null)} title={view?.returnNo ?? ''} description={view ? `${view.supplierName} · ${formatDate(view.date)}` : undefined} size="lg">
        {view && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-600">Reason: {view.reason}</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="border-b border-neutral-200 text-xs uppercase text-neutral-500">
                  <tr><th className="py-2 pr-3">Product</th><th className="py-2 pr-3">Batch</th><th className="py-2 pr-3">Stock</th><th className="py-2 pr-3 text-right">Qty</th><th className="py-2 pr-3 text-right">Rate</th><th className="py-2 text-right">GST</th></tr>
                </thead>
                <tbody className="tabular divide-y divide-neutral-100">
                  {view.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="py-2 pr-3">{lk.productName(l.productId)}</td>
                      <td className="py-2 pr-3">{batchNo(l.batchId)}</td>
                      <td className="py-2 pr-3"><StatusBadge status={l.bucket} /></td>
                      <td className="py-2 pr-3 text-right">{formatNumber(l.qty)}</td>
                      <td className="py-2 pr-3 text-right">{formatCurrency(l.rate)}</td>
                      <td className="py-2 text-right">{l.gstRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tabular text-right text-sm font-semibold">Total credit: {formatCurrency(view.total)}</p>
          </div>
        )}
      </Modal>
    </>
  );
}
