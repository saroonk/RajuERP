import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Eye, Plus } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { StockBucket, WriteOff } from '@/types';
import { formatCurrency, formatDate, formatNumber, titleCase } from '@/utils/format';
import { WriteOffDialog, type WriteOffLineInit } from '../components/WriteOffDialog';

type Row = WriteOff & { lineCount: number; totalQty: number };

export default function WriteOffsPage() {
  const canEdit = useAuth().can('inventory', 'edit');
  const [params, setParams] = useSearchParams();
  const list = useData(() => services.inventory.writeOffs());
  const batchesQ = useData(() => services.inventory.batchStock());
  const batches = useMemo(() => batchesQ.data ?? [], [batchesQ.data]);
  const [dialog, setDialog] = useState<{ lines: WriteOffLineInit[]; reason: string } | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);
  const handled = useRef(false);

  const expired = useMemo(() => batches.filter((b) => b.expiryStatus === 'expired' && b.saleable + b.expired > 0), [batches]);
  const expiredValue = expired.reduce((s, b) => s + (b.saleable + b.expired) * b.costPrice, 0);

  // `?batch=` opens the form with that batch pre-selected.
  useEffect(() => {
    const id = params.get('batch');
    if (!id || handled.current || !batches.length) return;
    handled.current = true;
    const b = batches.find((x) => x.id === id);
    const bucket = (['expired', 'damaged', 'inspection', 'saleable'] as StockBucket[]).find((k) => b && b[k] > 0);
    if (canEdit && b && bucket) setDialog({ lines: [{ batchId: b.id, bucket, qty: b[bucket] }], reason: b.expiryStatus === 'expired' ? 'Expired stock disposal' : '' });
    setParams({}, { replace: true });
  }, [params, batches, canEdit, setParams]);

  const writeOffAllExpired = () => {
    const lines: WriteOffLineInit[] = expired.flatMap((b) => (['saleable', 'expired'] as StockBucket[]).filter((k) => b[k] > 0).map((k) => ({ batchId: b.id, bucket: k, qty: b[k] })));
    setDialog({ lines, reason: 'Expired stock disposal' });
  };

  const batchLabel = (id: string) => batches.find((b) => b.id === id);
  const columns: Column<Row>[] = [
    { key: 'no', header: 'Write-off no.', value: (w) => w.writeOffNo, primary: true, cell: (w) => <span className="font-medium text-neutral-900">{w.writeOffNo}</span> },
    { key: 'date', header: 'Date', value: (w) => w.date, cell: (w) => formatDate(w.date) },
    { key: 'reason', header: 'Reason', value: (w) => w.reason },
    { key: 'lines', header: 'Batches', align: 'right', value: (w) => w.lineCount },
    { key: 'qty', header: 'Units', align: 'right', value: (w) => w.totalQty, cell: (w) => formatNumber(w.totalQty) },
    { key: 'value', header: 'Value', align: 'right', value: (w) => w.totalValue, cell: (w) => formatCurrency(w.totalValue) },
  ];

  return (
    <>
      <PageHeader
        title="Expired stock write-off"
        description="Record expired or unusable stock as a write-off with the matching stock adjustment."
        breadcrumbs={[{ label: 'Inventory' }, { label: 'Expired write-offs' }]}
        actions={canEdit && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setDialog({ lines: [], reason: '' })}>Record write-off</Button>}
      />
      {expired.length > 0 && (
        <div role="status" className="mb-4 flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <div className="text-sm text-red-900">
              <p className="font-medium">{expired.length} expired batch{expired.length > 1 ? 'es' : ''} still hold stock worth {formatCurrency(expiredValue)}</p>
              <p className="mt-0.5 text-xs">{expired.slice(0, 4).map((b) => `${b.productName} (${b.batchNo})`).join(', ')}{expired.length > 4 ? ` and ${expired.length - 4} more` : ''}</p>
            </div>
          </div>
          {canEdit && <Button variant="danger" size="sm" onClick={writeOffAllExpired}>Write off all expired</Button>}
        </div>
      )}
      <DataTable
        data={list.data}
        columns={columns}
        rowKey={(w) => w.id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        searchText={(w) => `${w.writeOffNo} ${w.reason}`}
        exportName="write-offs"
        defaultSort={{ key: 'date', dir: 'desc' }}
        emptyTitle="No write-offs recorded"
        emptyDescription="Expired or unusable stock written off will appear here."
        onRowClick={setViewing}
        rowActions={(w) => [{ label: 'View', icon: <Eye className="h-4 w-4" />, onClick: () => setViewing(w) }]}
      />

      <WriteOffDialog open={!!dialog} onClose={() => setDialog(null)} batches={batches} initialLines={dialog?.lines ?? []} initialReason={dialog?.reason} />

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.writeOffNo ?? ''} description={viewing ? `${formatDate(viewing.date)} · ${viewing.reason}` : undefined} size="lg" footer={<Button variant="secondary" onClick={() => setViewing(null)}>Close</Button>}>
        <ul className="divide-y divide-neutral-100">
          {viewing?.lines.map((l, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span>
                <span className="font-medium text-neutral-900">{batchLabel(l.batchId)?.productName ?? l.productId}</span>
                <span className="block text-xs text-neutral-500">Batch {batchLabel(l.batchId)?.batchNo ?? l.batchId} · {titleCase(l.bucket)} bucket</span>
              </span>
              <span className="tabular text-right">
                {formatNumber(l.qty)} × {formatCurrency(l.unitCost)}
                <span className="block font-medium">{formatCurrency(l.qty * l.unitCost)}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-right text-sm font-semibold">Total: {formatCurrency(viewing?.totalValue)}</p>
      </Modal>
    </>
  );
}
