import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { Calculator, Layers, Wallet } from 'lucide-react';
import { DataTable, type Column } from '@/components/data/DataTable';
import { CHART_COLORS, ChartCard, chartAxis, chartGrid } from '@/components/data/ChartCard';
import { StatCard } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/utils/cn';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { ValuationMethod, ValuationRow } from '@/types';
import { formatCompactINR, formatCurrency, formatCurrencyWhole, formatNumber, round2 } from '@/utils/format';

const METHODS: { key: ValuationMethod; label: string; help: string }[] = [
  { key: 'fifo', label: 'FIFO', help: 'First-in, first-out: the oldest receipts are assumed sold first, so remaining stock is valued at the cost of the newest receipts.' },
  { key: 'weighted_average', label: 'Weighted average', help: 'All receipts of a product are averaged by quantity, and remaining stock is valued at that average unit cost.' },
];

export default function ValuationPage() {
  const settings = useData(() => services.admin.settings());
  const [override, setOverride] = useState<ValuationMethod | null>(null);
  const method = override ?? settings.data?.valuationMethod ?? 'fifo';
  const val = useData(() => services.inventory.valuation(method), [method]);

  const rows = val.data;
  const totals = useMemo(() => {
    const r = rows ?? [];
    return { qty: r.reduce((s, x) => s + x.qty, 0), value: round2(r.reduce((s, x) => s + x.value, 0)), held: round2(r.reduce((s, x) => s + x.heldValue, 0)) };
  }, [rows]);
  const byBrand = useMemo(() => {
    const m = new Map<string, number>();
    (rows ?? []).forEach((r) => m.set(r.brandName, (m.get(r.brandName) ?? 0) + r.value));
    return [...m.entries()].map(([brand, value]) => ({ brand, value: round2(value) })).sort((a, b) => b.value - a.value);
  }, [rows]);

  const columns: Column<ValuationRow>[] = [
    { key: 'sku', header: 'SKU', value: (r) => r.sku },
    { key: 'name', header: 'Product', value: (r) => r.name, primary: true, cell: (r) => <span className="font-medium text-neutral-900">{r.name}</span> },
    { key: 'brand', header: 'Brand', value: (r) => r.brandName },
    { key: 'qty', header: 'Saleable qty', align: 'right', value: (r) => r.qty, cell: (r) => formatNumber(r.qty) },
    { key: 'cost', header: 'Unit cost', align: 'right', value: (r) => r.unitCost, cell: (r) => formatCurrency(r.unitCost) },
    { key: 'value', header: 'Stock value', align: 'right', value: (r) => r.value, cell: (r) => <span className="font-medium">{formatCurrency(r.value)}</span> },
    { key: 'held', header: 'Held value', align: 'right', value: (r) => r.heldValue, cell: (r) => formatCurrency(r.heldValue) },
  ];

  return (
    <>
      <PageHeader title="Stock valuation" description="Inventory value under the selected costing method." breadcrumbs={[{ label: 'Inventory' }, { label: 'Stock valuation' }]} />
      <div className="mb-4 surface p-3.5">
        <div role="group" aria-label="Valuation method" className="inline-flex rounded-xl bg-slate-900/[0.05] p-1 ring-1 ring-slate-900/[0.04]">
          {METHODS.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={method === m.key}
              onClick={() => setOverride(m.key)}
              className={cn('rounded-md px-3 py-2 text-sm font-medium md:py-1.5', method === m.key ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100')}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-neutral-500">{METHODS.find((m) => m.key === method)?.help} Held value covers damaged, expired and inspection stock still on hand, at batch cost.</p>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Saleable stock value" value={formatCurrencyWhole(totals.value)} hint={`${formatNumber(totals.qty)} units`} icon={<Wallet className="h-4 w-4" />} />
        <StatCard label="Held for disposition" value={formatCurrencyWhole(totals.held)} hint="Damaged / expired / inspection, at cost" icon={<Layers className="h-4 w-4" />} tone={totals.held ? 'warning' : 'default'} />
        <StatCard label="Costing method" value={METHODS.find((m) => m.key === method)?.label} hint="Default is set in Settings" icon={<Calculator className="h-4 w-4" />} />
      </div>
      <div className="mb-4">
        <ChartCard title="Stock value by brand" height={240} empty={byBrand.length === 0}>
          <BarChart data={byBrand} margin={{ left: 0, right: 8, top: 4 }}>
            <CartesianGrid stroke={chartGrid} strokeDasharray="4 6" vertical={false} />
            <XAxis dataKey="brand" tick={chartAxis} interval={0} tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 11)}…` : v)} />
            <YAxis tick={chartAxis} tickFormatter={formatCompactINR} width={56} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} />
            <Bar dataKey="value" name="Stock value" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ChartCard>
      </div>
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.productId}
        loading={val.loading && !rows}
        error={val.error}
        onRetry={val.reload}
        searchText={(r) => `${r.sku} ${r.name} ${r.brandName}`}
        exportName={`stock-valuation-${method}`}
        defaultSort={{ key: 'value', dir: 'desc' }}
        emptyTitle="No stock to value"
        summary={() => (
          <div className="flex flex-wrap justify-between gap-2 font-medium">
            <span>Total ({formatNumber(totals.qty)} units)</span>
            <span className="tabular">{formatCurrency(totals.value)} · held {formatCurrency(totals.held)}</span>
          </div>
        )}
      />
    </>
  );
}
