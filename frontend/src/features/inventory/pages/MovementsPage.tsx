import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { DataTable, type Column } from '@/components/data/DataTable';
import { DateRangeFilter, rangeFor } from '@/components/data/DateRangeFilter';
import { Badge, type Tone } from '@/components/ui/Badge';
import { FilterSelect } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/utils/cn';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { DateRange, MovementRow, MovementType, StockBucket } from '@/types';
import { formatDate, formatNumber, titleCase } from '@/utils/format';

const TYPES: Record<MovementType, { label: string; tone: Tone }> = {
  receipt: { label: 'Receipt', tone: 'success' },
  dispatch: { label: 'Dispatch', tone: 'info' },
  sales_return: { label: 'Sales return', tone: 'warning' },
  supplier_return: { label: 'Supplier return', tone: 'warning' },
  adjustment: { label: 'Adjustment', tone: 'neutral' },
  write_off: { label: 'Write-off', tone: 'danger' },
  reclassification: { label: 'Reclassification', tone: 'neutral' },
};
const BUCKETS: StockBucket[] = ['saleable', 'damaged', 'expired', 'inspection'];

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button type="button" onClick={onRemove} aria-label={`Remove filter ${label}`} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-200">
      {label} <X className="h-3 w-3" />
    </button>
  );
}

export default function MovementsPage() {
  const [params, setParams] = useSearchParams();
  const batchId = params.get('batch') ?? '';
  const productId = params.get('product') ?? '';
  const moves = useData(() => services.inventory.movements());
  const [type, setType] = useState('');
  const [bucket, setBucket] = useState('');
  const [range, setRange] = useState<DateRange>(rangeFor('all'));

  const rows = useMemo(
    () =>
      (moves.data ?? []).filter(
        (m) => (!type || m.type === type) && (!bucket || m.bucket === bucket) && (!batchId || m.batchId === batchId) && (!productId || m.productId === productId) && m.date >= range.from && m.date <= range.to,
      ),
    [moves.data, type, bucket, batchId, productId, range],
  );
  const sample = moves.data?.find((m) => (batchId && m.batchId === batchId) || (productId && m.productId === productId));
  const drop = (key: string) => {
    const next = new URLSearchParams(params);
    next.delete(key);
    setParams(next);
  };

  const columns: Column<MovementRow>[] = [
    { key: 'date', header: 'Date', value: (m) => m.date, cell: (m) => formatDate(m.date) },
    { key: 'type', header: 'Type', value: (m) => TYPES[m.type].label, cell: (m) => <Badge tone={TYPES[m.type].tone}>{TYPES[m.type].label}</Badge> },
    { key: 'product', header: 'Product', value: (m) => m.productName, primary: true, cell: (m) => <span className="font-medium text-neutral-900">{m.productName}</span> },
    { key: 'batch', header: 'Batch', value: (m) => m.batchNo },
    { key: 'bucket', header: 'Bucket', value: (m) => titleCase(m.bucket) },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      value: (m) => m.qty,
      cell: (m) => <span className={cn('font-medium', m.qty > 0 ? 'text-emerald-700' : 'text-red-600')}>{m.qty > 0 ? '+' : '−'}{formatNumber(Math.abs(m.qty))}</span>,
    },
    { key: 'ref', header: 'Reference', value: (m) => m.refNo, cell: (m) => <span>{m.refNo}<span className="block text-xs text-neutral-400">{m.refType}</span></span> },
    { key: 'note', header: 'Note', value: (m) => m.note, hideOnMobile: true },
    { key: 'by', header: 'By', value: (m) => m.createdBy, hideOnMobile: true },
  ];

  return (
    <>
      <PageHeader title="Stock movement history" description="Every stock change is a movement row; batch quantities are always derived from this ledger." breadcrumbs={[{ label: 'Inventory' }, { label: 'Stock movements' }]} />
      {(batchId || productId) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {batchId && <Chip label={`Batch: ${sample?.batchNo ?? batchId}`} onRemove={() => drop('batch')} />}
          {productId && <Chip label={`Product: ${sample?.productName ?? productId}`} onRemove={() => drop('product')} />}
        </div>
      )}
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(m) => m.id}
        loading={moves.loading}
        error={moves.error}
        onRetry={moves.reload}
        searchText={(m) => `${m.productName} ${m.sku} ${m.batchNo} ${m.refNo} ${m.note}`}
        searchPlaceholder="Search product, batch, reference…"
        exportName="stock-movements"
        pageSize={25}
        defaultSort={{ key: 'date', dir: 'desc' }}
        emptyTitle="No stock movements"
        filters={
          <>
            <FilterSelect value={type} onChange={setType} allLabel="All types" options={Object.entries(TYPES).map(([value, t]) => ({ value, label: t.label }))} />
            <FilterSelect value={bucket} onChange={setBucket} allLabel="All buckets" options={BUCKETS.map((b) => ({ value: b, label: titleCase(b) }))} />
            <DateRangeFilter value={range} onChange={setRange} />
          </>
        }
      />
    </>
  );
}
