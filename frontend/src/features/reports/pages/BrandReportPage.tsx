import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartCard, CHART_COLORS, chartAxis, chartGrid } from '@/components/data/ChartCard';
import { DataTable, type Column } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { BrandReportRow } from '@/types';
import { formatCompactINR, formatCurrency, formatNumber, formatPercent } from '@/utils/format';
import { ReportShell, truncate, useReportRange } from '../components/ReportShell';

export default function BrandReportPage() {
  const [range, setRange] = useReportRange();
  const report = useData(() => services.reports.brands(range), [range.from, range.to]);
  const rows = report.data ?? [];
  const sum = (type: 'own' | 'external') => rows.filter((r) => r.type === type).reduce((s, r) => s + r.revenue, 0);
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  const own = sum('own');
  const chartRows = [...rows].sort((a, b) => b.revenue - a.revenue);

  const columns: Column<BrandReportRow>[] = [
    { key: 'brand', header: 'Brand', value: (r) => r.brandName, primary: true, cell: (r) => <span className="font-medium">{r.brandName}</span> },
    { key: 'type', header: 'Type', value: (r) => r.type, cell: (r) => <StatusBadge status={r.type} label={r.type === 'own' ? 'Own brand' : 'External'} /> },
    { key: 'qty', header: 'Qty sold', align: 'right', value: (r) => r.qtySold, cell: (r) => formatNumber(r.qtySold) },
    { key: 'rev', header: 'Revenue', align: 'right', value: (r) => r.revenue, cell: (r) => formatCurrency(r.revenue) },
    { key: 'cost', header: 'Cost', align: 'right', value: (r) => r.cost, cell: (r) => formatCurrency(r.cost) },
    { key: 'margin', header: 'Margin', align: 'right', value: (r) => r.margin, cell: (r) => formatCurrency(r.margin) },
    { key: 'pct', header: 'Margin %', align: 'right', value: (r) => r.marginPct, cell: (r) => formatPercent(r.marginPct) },
    { key: 'stockQty', header: 'Stock qty', align: 'right', value: (r) => r.stockQty, cell: (r) => formatNumber(r.stockQty) },
    { key: 'stockVal', header: 'Stock value', align: 'right', value: (r) => r.stockValue, cell: (r) => formatCurrency(r.stockValue) },
  ];

  return (
    <ReportShell
      title="Brand-wise report"
      description="Sales, margin and stock by brand, own brands against third-party brands."
      range={range}
      onRangeChange={setRange}
      kpis={[
        { label: 'Total revenue', value: formatCurrency(total) },
        { label: 'Own brands', value: formatCurrency(own), hint: `${formatPercent(total ? (own / total) * 100 : 0)} of revenue` },
        { label: 'External brands', value: formatCurrency(sum('external')), hint: `${formatPercent(total ? ((total - own) / total) * 100 : 0)} of revenue` },
        { label: 'Stock value', value: formatCurrency(rows.reduce((s, r) => s + r.stockValue, 0)), hint: 'Saleable stock at cost' },
      ]}
    >
      <ChartCard title="Revenue and margin by brand" height={Math.max(220, chartRows.length * 44 + 50)} empty={chartRows.every((r) => r.revenue === 0)}>
        <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={chartGrid} strokeDasharray="4 6" horizontal={false} />
          <XAxis type="number" tickFormatter={formatCompactINR} tick={chartAxis} tickLine={false} />
          <YAxis type="category" dataKey="brandName" tickFormatter={(v) => truncate(String(v), 14)} tick={chartAxis} width={96} tickLine={false} axisLine={false} />
          <Tooltip formatter={(v) => formatCurrency(Number(v))} />
          <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
          <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS[0]} radius={[0, 6, 6, 0]} maxBarSize={20} />
          <Bar dataKey="margin" name="Margin" fill={CHART_COLORS[4]} radius={[0, 6, 6, 0]} maxBarSize={20} />
        </BarChart>
      </ChartCard>
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.brandId}
        loading={report.loading}
        error={report.error}
        onRetry={report.reload}
        searchText={(r) => r.brandName}
        searchPlaceholder="Search brands…"
        exportName="brand-report"
        defaultSort={{ key: 'rev', dir: 'desc' }}
        emptyTitle="No brands"
      />
    </ReportShell>
  );
}
