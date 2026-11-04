import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { Info } from 'lucide-react';
import { ChartCard, CHART_COLORS, chartAxis, chartGrid } from '@/components/data/ChartCard';
import { DataTable, type Column } from '@/components/data/DataTable';
import { DateRangeFilter, rangeFor } from '@/components/data/DateRangeFilter';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/States';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { DateRange } from '@/types';
import { cn } from '@/utils/cn';
import { formatCompactINR, formatCurrency, formatMonth, formatPercent } from '@/utils/format';

interface CatRow {
  categoryId: string;
  categoryName: string;
  amount: number;
  share: number;
}

function Line({ label, value, strong, sign }: { label: string; value: number; strong?: boolean; sign?: '+' | '−' }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-2 text-sm', strong && 'border-t border-neutral-200 font-semibold')}>
      <span className={cn(!strong && 'text-neutral-600')}>{sign && <span className="mr-1 text-neutral-400">{sign}</span>}{label}</span>
      <span className="tabular">{formatCurrency(value)}</span>
    </div>
  );
}

export default function SummaryPage() {
  const [range, setRange] = useState<DateRange>(rangeFor('this_month'));
  const summary = useData(() => services.accounts.summary(range), [range.from, range.to]);
  const s = summary.data;

  const cats: CatRow[] = (s?.expensesByCategory ?? []).map((c) => ({ ...c, share: s && s.totalExpenses ? (c.amount / s.totalExpenses) * 100 : 0 }));
  const catColumns: Column<CatRow>[] = [
    { key: 'cat', header: 'Category', value: (r) => r.categoryName, primary: true },
    { key: 'amount', header: 'Amount', align: 'right', value: (r) => r.amount, cell: (r) => formatCurrency(r.amount) },
    { key: 'share', header: 'Share', align: 'right', value: (r) => Math.round(r.share * 10) / 10, cell: (r) => formatPercent(r.share) },
  ];

  return (
    <>
      <PageHeader title="Income & expense summary" description="Operational income, purchases and expenses for a period." breadcrumbs={[{ label: 'Accounts' }, { label: 'Income & expense' }]} />
      <div className="mb-3">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>
      <p className="mb-4 flex items-start gap-2 rounded-xl bg-accent-50/70 p-3.5 text-xs text-neutral-600 ring-1 ring-accent-100">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        An operational summary of recorded sales, purchases and expenses (amounts before GST). It is not a profit &amp; loss statement and does not replace double-entry books.
      </p>

      {summary.loading || !s ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Net income" value={formatCurrency(s.netIncome)} hint="Sales net of credit notes" />
            <StatCard label="Net purchases" value={formatCurrency(s.netPurchases)} hint="Net of supplier returns" />
            <StatCard label="Total expenses" value={formatCurrency(s.totalExpenses)} />
            <StatCard label="Operating result" value={formatCurrency(s.operatingResult)} tone={s.operatingResult < 0 ? 'danger' : 'success'} hint="Income − purchases − expenses" />
            <StatCard label="Collections received" value={formatCurrency(s.collections)} />
            <StatCard label="Supplier payments" value={formatCurrency(s.supplierPayments)} />
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Income" />
              <CardBody className="divide-y divide-neutral-100 py-1">
                <Line label="Sales (taxable value)" value={s.salesTaxable} />
                <Line label="Credit notes" value={s.creditNotesTaxable} sign="−" />
                <Line label="Debit notes" value={s.debitNotesTaxable} sign="+" />
                <Line label="Net income" value={s.netIncome} strong />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Purchases" />
              <CardBody className="divide-y divide-neutral-100 py-1">
                <Line label="Goods received (taxable value)" value={s.purchasesTaxable} />
                <Line label="Supplier returns" value={s.supplierReturnsTaxable} sign="−" />
                <Line label="Net purchases" value={s.netPurchases} strong />
              </CardBody>
            </Card>
          </div>

          <div className="mb-4">
            <ChartCard title="Monthly income, purchases and expenses" empty={s.months.length === 0}>
              <BarChart data={s.months} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={chartGrid} strokeDasharray="4 6" vertical={false} />
                <XAxis dataKey="month" tickFormatter={formatMonth} tick={chartAxis} tickLine={false} interval="preserveStartEnd" />
                <YAxis tickFormatter={formatCompactINR} tick={chartAxis} tickLine={false} axisLine={false} width={52} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} labelFormatter={(l) => formatMonth(String(l))} />
                <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                <Bar dataKey="income" name="Income" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} maxBarSize={32} />
                <Bar dataKey="purchases" name="Purchases" fill={CHART_COLORS[2]} radius={[6, 6, 0, 0]} maxBarSize={32} />
                <Bar dataKey="expenses" name="Expenses" fill={CHART_COLORS[3]} radius={[6, 6, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ChartCard>
          </div>

          <h2 className="mb-2 text-sm font-semibold">Expenses by category</h2>
          <DataTable
            data={cats}
            columns={catColumns}
            rowKey={(r) => r.categoryId}
            exportName="expenses-by-category"
            defaultSort={{ key: 'amount', dir: 'desc' }}
            emptyTitle="No expenses in this period"
            summary={() => (
              <div className="flex justify-between font-semibold">
                <span>Total</span>
                <span className="tabular">{formatCurrency(s.totalExpenses)}</span>
              </div>
            )}
          />
        </>
      )}
    </>
  );
}
