import { useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { FilterSelect } from '@/components/ui/Inputs';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { ProductClass, ProductPerfRow } from '@/types';
import { cn } from '@/utils/cn';
import { formatCurrency, formatDate, formatNumber } from '@/utils/format';
import { ReportShell, useReportRange } from '../components/ReportShell';

const CLASSES: { key: ProductClass; label: string }[] = [
  { key: 'high_selling', label: 'High-selling' },
  { key: 'average', label: 'Average' },
  { key: 'slow_moving', label: 'Slow-moving' },
  { key: 'low_performing', label: 'Low-performing' },
];

export default function ProductPerformancePage() {
  const [range, setRange] = useReportRange();
  const [cls, setCls] = useState<ProductClass | ''>('');
  const [brand, setBrand] = useState('');
  const report = useData(() => services.reports.products(range), [range.from, range.to]);
  const all = useMemo(() => report.data ?? [], [report.data]);

  const brands = useMemo(() => [...new Set(all.map((r) => r.brandName))].sort().map((b) => ({ value: b, label: b })), [all]);
  const rows = useMemo(() => all.filter((r) => (!cls || r.classification === cls) && (!brand || r.brandName === brand)), [all, cls, brand]);
  const count = (k: ProductClass) => all.filter((r) => r.classification === k).length;

  const columns: Column<ProductPerfRow>[] = [
    { key: 'sku', header: 'SKU', value: (r) => r.sku, hideOnMobile: true },
    { key: 'name', header: 'Product', value: (r) => r.name, primary: true, cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'brand', header: 'Brand', value: (r) => r.brandName },
    { key: 'qty', header: 'Qty sold', align: 'right', value: (r) => r.qtySold, cell: (r) => formatNumber(r.qtySold) },
    { key: 'rev', header: 'Revenue', align: 'right', value: (r) => r.revenue, cell: (r) => formatCurrency(r.revenue) },
    { key: 'margin', header: 'Margin', align: 'right', value: (r) => r.margin, cell: (r) => formatCurrency(r.margin) },
    { key: 'stock', header: 'Stock on hand', align: 'right', value: (r) => r.stockOnHand, cell: (r) => formatNumber(r.stockOnHand) },
    { key: 'last', header: 'Last sale', value: (r) => r.lastSaleDate, cell: (r) => formatDate(r.lastSaleDate) },
    { key: 'class', header: 'Performance', value: (r) => r.classification, cell: (r) => <StatusBadge status={r.classification} /> },
  ];

  return (
    <ReportShell
      title="Product performance"
      description="Identify high-selling, slow-moving and low-performing products."
      range={range}
      onRangeChange={setRange}
      note="Classes are relative to the selected period: the top quarter of selling products by revenue is high-selling, the bottom 40% of sellers is slow-moving, and products with no sales in the period are low-performing."
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {CLASSES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCls(cls === c.key ? '' : c.key)}
            aria-pressed={cls === c.key}
            className={cn('rounded-2xl bg-white p-5 text-left shadow-card ring-1 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-hover', cls === c.key ? 'ring-2 ring-neutral-900' : 'ring-slate-900/[0.05]')}
          >
            <p className="text-xs font-medium text-neutral-500">{c.label}</p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight">{count(c.key)}</p>
            <p className="mt-1 text-xs text-neutral-500">{cls === c.key ? 'Click to clear filter' : 'Click to filter'}</p>
          </button>
        ))}
      </div>
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.productId}
        loading={report.loading}
        error={report.error}
        onRetry={report.reload}
        searchText={(r) => `${r.sku} ${r.name} ${r.brandName}`}
        searchPlaceholder="Search products…"
        exportName="product-performance"
        defaultSort={{ key: 'rev', dir: 'desc' }}
        emptyTitle="No products"
        filters={<FilterSelect value={brand} onChange={setBrand} allLabel="All brands" options={brands} />}
      />
    </ReportShell>
  );
}
