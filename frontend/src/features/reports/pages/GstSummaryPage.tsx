import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartCard, CHART_COLORS, chartAxis, chartGrid } from '@/components/data/ChartCard';
import { DataTable, type Column } from '@/components/data/DataTable';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import { formatCompactINR, formatCurrency, formatMonth } from '@/utils/format';
import { ReportShell, useReportRange } from '../components/ReportShell';

type RateRow = { rate: number; taxable: number; cgst: number; sgst: number; igst: number; tax: number };
type MonthRow = { month: string; taxable: number; tax: number };

export default function GstSummaryPage() {
  const [range, setRange] = useReportRange();
  const report = useData(() => services.reports.gstSummary(range), [range.from, range.to]);
  const g = report.data;

  const rateCols: Column<RateRow>[] = [
    { key: 'rate', header: 'GST rate', value: (r) => r.rate, primary: true, cell: (r) => <span className="font-medium">{r.rate}%</span> },
    { key: 'taxable', header: 'Taxable value', align: 'right', value: (r) => r.taxable, cell: (r) => formatCurrency(r.taxable) },
    { key: 'cgst', header: 'CGST', align: 'right', value: (r) => r.cgst, cell: (r) => formatCurrency(r.cgst) },
    { key: 'sgst', header: 'SGST', align: 'right', value: (r) => r.sgst, cell: (r) => formatCurrency(r.sgst) },
    { key: 'igst', header: 'IGST', align: 'right', value: (r) => r.igst, cell: (r) => formatCurrency(r.igst) },
    { key: 'tax', header: 'Total GST', align: 'right', value: (r) => r.tax, cell: (r) => <span className="font-semibold">{formatCurrency(r.tax)}</span> },
  ];
  const monthCols: Column<MonthRow>[] = [
    { key: 'month', header: 'Month', value: (r) => r.month, primary: true, cell: (r) => formatMonth(r.month), csv: (r) => r.month },
    { key: 'taxable', header: 'Taxable value', align: 'right', value: (r) => r.taxable, cell: (r) => formatCurrency(r.taxable) },
    { key: 'tax', header: 'GST collected', align: 'right', value: (r) => r.tax, cell: (r) => formatCurrency(r.tax) },
  ];

  return (
    <ReportShell
      title="GST summary"
      description="Taxable values and GST on sales, notes and purchases for the period."
      range={range}
      onRangeChange={setRange}
      note="Transaction summary only. GST return filing, e-invoicing and e-way bill integration are not included; validate figures and reporting scope with your accountant."
      kpis={
        g && [
          { label: 'Taxable sales', value: formatCurrency(g.output.taxable) },
          { label: 'Output GST collected', value: formatCurrency(g.output.tax), hint: `CGST ${formatCurrency(g.output.cgst)} · SGST ${formatCurrency(g.output.sgst)} · IGST ${formatCurrency(g.output.igst)}` },
          { label: 'Less: credit-note GST', value: formatCurrency(g.output.creditNoteTax) },
          { label: 'Plus: debit-note GST', value: formatCurrency(g.output.debitNoteTax) },
          { label: 'Net output GST', value: formatCurrency(g.output.netTax), tone: 'success' },
          { label: 'Input GST on purchases', value: formatCurrency(g.input.tax), hint: `On ${formatCurrency(g.input.taxable)} taxable, net of supplier returns` },
        ]
      }
    >
      <ChartCard title="GST collected by month" empty={(g?.byMonth.length ?? 0) === 0}>
        <BarChart data={g?.byMonth ?? []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={chartGrid} strokeDasharray="4 6" vertical={false} />
          <XAxis dataKey="month" tickFormatter={formatMonth} tick={chartAxis} tickLine={false} interval="preserveStartEnd" />
          <YAxis tickFormatter={formatCompactINR} tick={chartAxis} tickLine={false} axisLine={false} width={52} />
          <Tooltip formatter={(v) => formatCurrency(Number(v))} labelFormatter={(l) => formatMonth(String(l))} />
          <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
          <Bar dataKey="taxable" name="Taxable value" fill={CHART_COLORS[5]} radius={[6, 6, 0, 0]} maxBarSize={32} />
          <Bar dataKey="tax" name="GST collected" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ChartCard>
      <div>
        <h2 className="mb-2 text-sm font-semibold">By GST rate (sales)</h2>
        <DataTable
          data={g?.byRate}
          columns={rateCols}
          rowKey={(r) => String(r.rate)}
          loading={report.loading}
          error={report.error}
          onRetry={report.reload}
          exportName="gst-by-rate"
          defaultSort={{ key: 'rate', dir: 'asc' }}
          emptyTitle="No taxable sales in this period"
          summary={(rows) => (
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span className="tabular">{formatCurrency(rows.reduce((s, r) => s + r.tax, 0))}</span>
            </div>
          )}
        />
      </div>
      <div>
        <h2 className="mb-2 text-sm font-semibold">By month (sales)</h2>
        <DataTable
          data={g?.byMonth}
          columns={monthCols}
          rowKey={(r) => r.month}
          loading={report.loading}
          error={report.error}
          onRetry={report.reload}
          exportName="gst-by-month"
          defaultSort={{ key: 'month', dir: 'desc' }}
          emptyTitle="No taxable sales in this period"
        />
      </div>
    </ReportShell>
  );
}
