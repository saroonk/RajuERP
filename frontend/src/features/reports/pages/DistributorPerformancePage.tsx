import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartCard, CHART_COLORS, chartAxis, chartGrid } from '@/components/data/ChartCard';
import { DataTable, type Column } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { DistributorPerfRow } from '@/types';
import { formatCompactINR, formatCurrency, formatNumber, formatPercent } from '@/utils/format';
import { ReportShell, truncate, useReportRange } from '../components/ReportShell';

export default function DistributorPerformancePage() {
  const [range, setRange] = useReportRange();
  const report = useData(() => services.reports.distributors(range), [range.from, range.to]);
  const rows = report.data ?? [];
  const top = [...rows].filter((r) => r.taxable > 0).sort((a, b) => b.taxable - a.taxable).slice(0, 8);
  const sales = rows.reduce((s, r) => s + r.taxable, 0);
  const collected = rows.reduce((s, r) => s + r.collected, 0);
  const returns = rows.reduce((s, r) => s + r.returnsValue, 0);

  const columns: Column<DistributorPerfRow>[] = [
    { key: 'name', header: 'Distributor', value: (r) => r.distributorName, primary: true, cell: (r) => <span className="font-medium">{r.distributorName}</span> },
    { key: 'type', header: 'Type', value: (r) => r.type, cell: (r) => <StatusBadge status={r.type} /> },
    { key: 'inv', header: 'Invoices', align: 'right', value: (r) => r.invoices, cell: (r) => formatNumber(r.invoices) },
    { key: 'taxable', header: 'Sales (taxable)', align: 'right', value: (r) => r.taxable, cell: (r) => formatCurrency(r.taxable) },
    { key: 'invoiced', header: 'Invoiced total', align: 'right', value: (r) => r.invoiced, cell: (r) => formatCurrency(r.invoiced) },
    { key: 'collected', header: 'Collected', align: 'right', value: (r) => r.collected, cell: (r) => formatCurrency(r.collected) },
    { key: 'out', header: 'Outstanding now', align: 'right', value: (r) => r.outstanding, cell: (r) => formatCurrency(r.outstanding) },
    { key: 'ret', header: 'Returns', align: 'right', value: (r) => r.returnsValue, cell: (r) => formatCurrency(r.returnsValue) },
    { key: 'retPct', header: 'Return %', align: 'right', value: (r) => r.returnPct, cell: (r) => formatPercent(r.returnPct) },
    { key: 'reported', header: 'Reported sales (units)', align: 'right', value: (r) => r.reportedSales, cell: (r) => (r.reportedSales == null ? '—' : formatNumber(r.reportedSales)) },
  ];

  return (
    <ReportShell
      title="Distributor performance"
      description="Sales, collections, outstanding balances and returns by distributor and dealer."
      range={range}
      onRangeChange={setRange}
      note="Sales here are what we invoiced to distributors, not what they sold on. Reported sales appear only where a distributor has supplied (or someone has entered) sales reports for the period."
      kpis={[
        { label: 'Sales (taxable)', value: formatCurrency(sales) },
        { label: 'Collected', value: formatCurrency(collected), hint: 'Receipts in the period' },
        { label: 'Outstanding now', value: formatCurrency(rows.reduce((s, r) => s + Math.max(0, r.outstanding), 0)) },
        { label: 'Returns', value: formatCurrency(returns), hint: `${formatPercent(sales ? (returns / sales) * 100 : 0)} of sales` },
      ]}
    >
      <ChartCard title="Top distributors by sales" description="Taxable sales against collections" height={Math.max(220, top.length * 44 + 50)} empty={top.length === 0}>
        <BarChart data={top} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={chartGrid} strokeDasharray="4 6" horizontal={false} />
          <XAxis type="number" tickFormatter={formatCompactINR} tick={chartAxis} tickLine={false} />
          <YAxis type="category" dataKey="distributorName" tickFormatter={(v) => truncate(String(v), 16)} tick={chartAxis} width={110} tickLine={false} axisLine={false} />
          <Tooltip formatter={(v) => formatCurrency(Number(v))} />
          <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
          <Bar dataKey="taxable" name="Sales" fill={CHART_COLORS[0]} radius={[0, 6, 6, 0]} maxBarSize={20} />
          <Bar dataKey="collected" name="Collected" fill={CHART_COLORS[4]} radius={[0, 6, 6, 0]} maxBarSize={20} />
        </BarChart>
      </ChartCard>
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.distributorId}
        loading={report.loading}
        error={report.error}
        onRetry={report.reload}
        searchText={(r) => r.distributorName}
        searchPlaceholder="Search distributors…"
        exportName="distributor-performance"
        defaultSort={{ key: 'taxable', dir: 'desc' }}
        emptyTitle="No distributors"
      />
    </ReportShell>
  );
}
