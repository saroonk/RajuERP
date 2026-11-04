import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, Trash2, X } from 'lucide-react';
import { DataTable, type Column } from '@/components/data/DataTable';
import { useAuth } from '@/app/AuthContext';
import { Checkbox, FilterSelect } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/utils/cn';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { BatchStock, ExpiryStatus } from '@/types';
import { formatCurrency, formatDate, formatNumber } from '@/utils/format';
import { ExpiryDays } from '../components/ExpiryCell';

const CHIPS: { key: ExpiryStatus; label: string; tone: string }[] = [
  { key: 'expired', label: 'Expired', tone: 'border-red-300 text-red-700' },
  { key: 'critical', label: 'Expiring ≤ 30 days', tone: 'border-red-200 text-red-700' },
  { key: 'warning', label: 'Expiring soon', tone: 'border-amber-300 text-amber-800' },
  { key: 'ok', label: 'OK', tone: 'border-emerald-300 text-emerald-700' },
];

export default function BatchesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const productId = params.get('product') ?? '';
  const lk = useLookups();
  const canEdit = useAuth().can('inventory', 'edit');
  const batches = useData(() => services.inventory.batchStock());
  const [expiry, setExpiry] = useState<ExpiryStatus | ''>('');
  const [brand, setBrand] = useState('');
  const [withStock, setWithStock] = useState(true);

  const base = useMemo(() => (batches.data ?? []).filter((b) => (!withStock || b.onHand > 0) && (!brand || b.brandId === brand) && (!productId || b.productId === productId)), [batches.data, withStock, brand, productId]);
  const counts = useMemo(() => {
    const c: Record<ExpiryStatus, number> = { expired: 0, critical: 0, warning: 0, ok: 0 };
    base.forEach((b) => c[b.expiryStatus]++);
    return c;
  }, [base]);
  const rows = useMemo(() => base.filter((b) => !expiry || b.expiryStatus === expiry), [base, expiry]);

  const columns: Column<BatchStock>[] = [
    { key: 'batch', header: 'Batch', value: (b) => b.batchNo, primary: true, cell: (b) => <span className="font-medium text-neutral-900">{b.batchNo}</span> },
    { key: 'product', header: 'Product', value: (b) => b.productName, cell: (b) => <span>{b.productName}<span className="block text-xs text-neutral-400">{b.sku}</span></span> },
    { key: 'brand', header: 'Brand', value: (b) => b.brandName, hideOnMobile: true },
    { key: 'mfg', header: 'Mfg date', value: (b) => b.mfgDate, cell: (b) => formatDate(b.mfgDate), hideOnMobile: true },
    { key: 'expiry', header: 'Expiry', value: (b) => b.expiryDate, cell: (b) => formatDate(b.expiryDate) },
    { key: 'days', header: 'Days to expiry', value: (b) => b.daysToExpiry, cell: (b) => <ExpiryDays days={b.daysToExpiry} status={b.expiryStatus} />, csv: (b) => b.daysToExpiry },
    { key: 'saleable', header: 'Saleable', align: 'right', value: (b) => b.saleable, cell: (b) => formatNumber(b.saleable) },
    { key: 'damaged', header: 'Damaged', align: 'right', value: (b) => b.damaged, cell: (b) => formatNumber(b.damaged) },
    { key: 'expired', header: 'Expired', align: 'right', value: (b) => b.expired, cell: (b) => formatNumber(b.expired) },
    { key: 'inspection', header: 'Inspection', align: 'right', value: (b) => b.inspection, cell: (b) => formatNumber(b.inspection) },
    { key: 'onhand', header: 'On hand', align: 'right', value: (b) => b.onHand, cell: (b) => <span className="font-medium">{formatNumber(b.onHand)}</span> },
    { key: 'cost', header: 'Unit cost', align: 'right', value: (b) => b.costPrice, cell: (b) => formatCurrency(b.costPrice) },
    { key: 'value', header: 'Stock value', align: 'right', value: (b) => b.onHand * b.costPrice, cell: (b) => formatCurrency(b.onHand * b.costPrice) },
  ];

  const productName = lk.product(productId)?.name ?? productId;

  return (
    <>
      <PageHeader title="Batches & expiry tracking" description="Every batch with its quantities per stock bucket and shelf-life status." breadcrumbs={[{ label: 'Inventory' }, { label: 'Batches & expiry' }]} />
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter by expiry status">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={expiry === c.key}
            onClick={() => setExpiry(expiry === c.key ? '' : c.key)}
            className={cn('rounded-full border bg-white px-3.5 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-slate-50', c.tone, expiry === c.key && 'bg-neutral-900 !border-neutral-900 !text-white hover:bg-neutral-800')}
          >
            {c.label} <span className="ml-1 tabular">{counts[c.key]}</span>
          </button>
        ))}
        {productId && (
          <button type="button" onClick={() => setParams({})} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-200" aria-label={`Remove product filter ${productName}`}>
            Product: {productName} <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(b) => b.id}
        loading={batches.loading}
        error={batches.error}
        onRetry={batches.reload}
        searchText={(b) => `${b.batchNo} ${b.productName} ${b.sku} ${b.brandName}`}
        searchPlaceholder="Search batch, product…"
        exportName="batches"
        defaultSort={{ key: 'expiry', dir: 'asc' }}
        emptyTitle="No batches"
        emptyDescription="Batches are created when goods are received against a purchase order."
        filters={
          <>
            <FilterSelect value={brand} onChange={setBrand} allLabel="All brands" options={lk.brands.map((b) => ({ value: b.id, label: b.name }))} />
            <Checkbox label="With stock only" checked={withStock} onChange={(e) => setWithStock(e.target.checked)} />
          </>
        }
        rowActions={(b) => [
          { label: 'Write off', icon: <Trash2 className="h-4 w-4" />, onClick: () => navigate(`/inventory/write-offs?batch=${b.id}`), disabled: b.onHand <= 0, hidden: !canEdit },
          { label: 'View movements', icon: <ArrowLeftRight className="h-4 w-4" />, onClick: () => navigate(`/inventory/movements?batch=${b.id}`) },
        ]}
      />
    </>
  );
}
