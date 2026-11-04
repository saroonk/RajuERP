import { Link } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartCard, CHART_COLORS, chartAxis, chartGrid } from '@/components/data/ChartCard';
import { DataTable, type Column } from '@/components/data/DataTable';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { SalesProfitRow } from '@/types';
import { cn } from '@/utils/cn';
import { formatCompactINR, formatCurrency, formatDate, formatMonth, formatPercent } from '@/utils/format';
import { ReportShell, useReportRange } from '../components/ReportShell';

export default function SalesProfitabilityPage() {
  const [range, setRange] = useReportRange();
  const report = useData(() => services.reports.salesProfitability(range), [range.from, range.to]);
  const rows = report.data?.rows ?? [];
  const revenue = rows.reduce((s, r) => s + r.revenue, 0);
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const margin = revenue - cost;

  const columns: Column<SalesProfitRow>[] = [
    { key: 'no', header: 'Invoice', value: (r) => r.invoiceNo, primary: true, cell: (r) => <Link to={`/sales/invoices/${r.invoiceId}`} className="font-medium hover:underline">{r.invoiceNo}</Link> },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date) },
    { key: 'dist', header: 'Distributor', value: (r) => r.distributorName },
    { key: 'rev', header: 'Revenue', align: 'right', value: (r) => r.revenue, cell: (r) => formatCurrency(r.revenue) },
    { key: 'cost', header: 'Cost', align: 'right', value: (r) => r.cost, cell: (r) => formatCurrency(r.cost) },
    { key: 'margin', header: 'Margin', align: 'right', value: (r) => r.margin, cell: (r) => <span className={cn('font-medium', r.margin < 0 && 'text-red-600')}>{formatCurrency(r.margin)}</span> },
    { key: 'pct', header: 'Margin %', align: 'right', value: (r) => r.marginPct, cell: (r) => formatPercent(r.marginPct) },
  ];

  return (
    <ReportShell
      title="Sales & profitability"
      description="Revenue, cost of goods and estimated margin per invoice."
      range={range}
      onRangeChange={setRange}
      note="Revenue is the taxable value (before GST) net of sales returns. Cost uses the recorded cost of the batches sold, so margin is an estimate and excludes operating expenses."
      kpis={[
        { label: 'Revenue', value: formatCurrency(revenue), hint: `${rows.length} invoices` },
        { label: 'Cost of goods', value: formatCurrency(cost) },
        { label: 'Estimated margin', value: formatCurrency(margin), tone: margin < 0 ? 'danger' : 'success' },
        { label: 'Margin %', value: formatPercent(revenue ? (margin / revenue) * 100 : 0) },
      ]}
    >
      <ChartCard title="Monthly trend" empty={(report.data?.trend.length ?? 0) === 0}>
        <ComposedChart data={report.data?.trend ?? []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={chartGrid} strokeDasharray="4 6" vertical={false} />
          <XAxis dataKey="month" tickFormatter={formatMonth} tick={chartAxis} tickLine={false} interval="preserveStartEnd" />
          <YAxis tickFormatter={formatCompactINR} tick={chartAxis} tickLine={false} axisLine={false} width={52} />
          <Tooltip formatter={(v) => formatCurrency(Number(v))} labelFormatter={(l) => formatMonth(String(l))} />
          <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
          <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} maxBarSize={32} />
          <Bar dataKey="cost" name="Cost" fill={CHART_COLORS[5]} radius={[6, 6, 0, 0]} maxBarSize={32} />
          <Line type="monotone" dataKey="margin" name="Margin" stroke={CHART_COLORS[4]} strokeWidth={2.5} dot={{ r: 4, strokeWidth: 2, stroke: CHART_COLORS[4], fill: '#fff' }} />
        </ComposedChart>
      </ChartCard>
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.invoiceId}
        loading={report.loading}
        error={report.error}
        onRetry={report.reload}
        searchText={(r) => `${r.invoiceNo} ${r.distributorName}`}
        searchPlaceholder="Search invoices…"
        exportName="sales-profitability"
        defaultSort={{ key: 'date', dir: 'desc' }}
        emptyTitle="No sales in this period"
        emptyDescription="Try a wider period."
      />
    </ReportShell>
  );
}
