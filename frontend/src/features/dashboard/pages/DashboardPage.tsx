import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Banknote, Boxes, ChevronRight, ClipboardList, FileText, Hourglass, PackageX, PieChart as PieIcon, ShoppingCart, TrendingUp, Users, Wallet } from 'lucide-react';
import { ChartCard, ChartLegend, ChartTooltip, CHART_COLORS, CHART_SCALE, chartAxis, chartGrid } from '@/components/data/ChartCard';
import { Sparkline } from '@/components/data/Sparkline';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, Loadable } from '@/components/ui/States';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { DashboardSummary } from '@/types';
import { cn } from '@/utils/cn';
import { formatCompactINR, formatCurrency, formatCurrencyWhole, formatDate, formatMonth, formatNumber, formatPercent } from '@/utils/format';

export default function DashboardPage() {
  const state = useData(() => services.dashboard.summary());
  return (
    <>
      <PageHeader title="Dashboard" description="Stock, sales, purchases, receivables and expiry at a glance." />
      <Loadable state={state}>{(d) => <Body d={d} />}</Loadable>
    </>
  );
}

const short = (s: string, n = 16) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const money = (v: number) => formatCurrency(v);

function Body({ d }: { d: DashboardSummary }) {
  const k = d.kpis;
  const delta = k.salesPrevMonth > 0 ? ((k.salesMonth - k.salesPrevMonth) / k.salesPrevMonth) * 100 : null;
  const monthly = d.monthly.map((m) => ({ ...m, label: formatMonth(m.month).slice(0, 3) }));
  const series = (key: 'sales' | 'purchases' | 'collections') => monthly.map((m) => ({ label: formatMonth(m.month), value: m[key] }));
  const dists = d.topDistributors.map((x) => ({ ...x, name: short(x.name, 24) }));
  const brandTotal = d.salesByBrand.reduce((s, b) => s + b.value, 0);
  const overduePct = k.receivables > 0 ? Math.min(100, (k.overdueReceivables / k.receivables) * 100) : 0;
  const alertCount = k.expiringBatches + k.expiredBatches;

  return (
    <div className="space-y-6">
      {/* KPI row 1: the featured stock card followed by the three monthly flows with their real 6-month trend */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          variant="dark"
          label="Stock value (saleable, at cost)"
          value={formatCurrencyWhole(k.stockValue)}
          icon={<Boxes />}
          to="/inventory/valuation"
          hint="Saleable, unexpired stock at batch cost"
          footer={
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/15">
              View valuation <ChevronRight className="h-3 w-3" />
            </span>
          }
          delay={0}
        />
        <StatCard
          label="Sales this month (excl. GST)"
          value={formatCurrencyWhole(k.salesMonth)}
          icon={<TrendingUp />}
          hint={
            delta === null ? (
              'No sales last month'
            ) : (
              <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', delta >= 0 ? 'bg-emerald-500/10 text-emerald-700' : 'bg-red-500/10 text-red-600')}>
                {delta >= 0 ? '▲' : '▼'} {formatPercent(Math.abs(delta))} vs last month
              </span>
            )
          }
          footer={<Sparkline data={series('sales')} color={CHART_COLORS[0]} format={money} />}
          to="/reports/sales"
          delay={60}
        />
        <StatCard
          label="Purchases this month (excl. GST)"
          value={formatCurrencyWhole(k.purchasesMonth)}
          icon={<ShoppingCart />}
          footer={<Sparkline data={series('purchases')} color={CHART_COLORS[1]} format={money} />}
          to="/purchases/receipts"
          delay={120}
        />
        <StatCard
          label="Collections this month"
          value={formatCurrencyWhole(k.collectionsMonth)}
          icon={<Banknote />}
          footer={<Sparkline data={series('collections')} color={CHART_COLORS[2]} format={money} />}
          to="/accounts/payments"
          delay={180}
        />
      </div>

      {/* KPI row 2: balances and the items that need attention */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Receivables outstanding"
          value={formatCurrencyWhole(k.receivables)}
          icon={<Wallet />}
          tone={k.overdueReceivables > 0 ? 'warning' : 'default'}
          variant={k.overdueReceivables > 0 ? 'tint' : 'default'}
          hint={`${formatCurrencyWhole(k.overdueReceivables)} overdue`}
          footer={
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-900/[0.07]" role="img" aria-label={`${Math.round(overduePct)}% of receivables overdue`}>
              <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600" style={{ width: `${overduePct}%` }} />
            </div>
          }
          to="/accounts/receivables"
          delay={240}
        />
        <StatCard label="Payables outstanding" value={formatCurrencyWhole(k.payables)} icon={<Wallet />} to="/accounts/payables" delay={300} />
        <StatCard
          label="Expiry alerts"
          value={formatNumber(alertCount)}
          icon={<Hourglass />}
          tone={k.expiredBatches > 0 ? 'danger' : k.expiringBatches > 0 ? 'warning' : 'default'}
          variant={alertCount > 0 ? 'tint' : 'default'}
          hint={`${k.expiringBatches} expiring · ${k.expiredBatches} expired batches`}
          to="/alerts"
          delay={360}
        />
        <StatCard
          label="Low-stock products"
          value={formatNumber(k.lowStockProducts)}
          icon={<PackageX />}
          tone={k.lowStockProducts > 0 ? 'warning' : 'default'}
          variant={k.lowStockProducts > 0 ? 'tint' : 'default'}
          hint={`${k.openOrders} open orders to dispatch`}
          to="/inventory"
          delay={420}
        />
      </div>

      {/* Trend + brand mix */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 [&>section]:h-full">
          <ChartCard
            title="Sales, purchases and collections"
            description="Last 6 months, excluding GST for sales and purchases"
            icon={<TrendingUp />}
            height={300}
            action={
              <ChartLegend
                items={[
                  { name: 'Sales', color: CHART_COLORS[0] },
                  { name: 'Purchases', color: CHART_COLORS[1] },
                  { name: 'Collections', color: CHART_COLORS[2] },
                ]}
              />
            }
          >
            <AreaChart data={monthly} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}>
              <defs>
                {[
                  ['dg-sales', CHART_COLORS[0], 0.22],
                  ['dg-purchases', CHART_COLORS[1], 0.28],
                  ['dg-collections', CHART_COLORS[2], 0.3],
                ].map(([id, color, op]) => (
                  <linearGradient key={id as string} id={id as string} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color as string} stopOpacity={op as number} />
                    <stop offset="100%" stopColor={color as string} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke={chartGrid} strokeDasharray="4 6" vertical={false} />
              <XAxis dataKey="label" tick={chartAxis} tickLine={false} axisLine={false} dy={6} />
              <YAxis tick={chartAxis} tickLine={false} axisLine={false} tickFormatter={formatCompactINR} width={56} />
              <Tooltip content={<ChartTooltip format={money} labelFormat={(_, p) => formatMonth(String((p as { payload?: { month?: string } }[])[0]?.payload?.month ?? ''))} />} cursor={{ stroke: '#94a3b8', strokeDasharray: '4 4' }} />
              <Area type="monotone" dataKey="purchases" name="Purchases" stroke={CHART_COLORS[1]} strokeWidth={2.5} fill="url(#dg-purchases)" dot={false} activeDot={{ r: 5, strokeWidth: 2.5, stroke: '#fff' }} />
              <Area type="monotone" dataKey="collections" name="Collections" stroke={CHART_COLORS[2]} strokeWidth={2.5} fill="url(#dg-collections)" dot={false} activeDot={{ r: 5, strokeWidth: 2.5, stroke: '#fff' }} />
              <Area type="monotone" dataKey="sales" name="Sales" stroke={CHART_COLORS[0]} strokeWidth={2.5} fill="url(#dg-sales)" dot={false} activeDot={{ r: 5, strokeWidth: 2.5, stroke: '#fff' }} />
            </AreaChart>
          </ChartCard>
        </div>

        <Card>
          <CardHeader title="Sales by brand" description="Last 3 months, excluding GST" icon={<PieIcon />} divider={false} className="pb-1" />
          <CardBody className="pt-2">
            {d.salesByBrand.length === 0 ? (
              <EmptyState title="No data for this period" />
            ) : (
              <div className="flex flex-col items-center gap-5">
                <div className="relative h-[190px] w-[190px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={d.salesByBrand} dataKey="value" nameKey="name" innerRadius={62} outerRadius={90} paddingAngle={3} cornerRadius={8} stroke="none" startAngle={90} endAngle={-270}>
                        {d.salesByBrand.map((b, i) => (
                          <Cell key={b.name} fill={CHART_SCALE[i % CHART_SCALE.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip format={money} />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">Total</span>
                    <span className="tabular text-2xl font-semibold tracking-tight text-neutral-900">{formatCompactINR(brandTotal)}</span>
                  </div>
                </div>
                <ul className="w-full space-y-2.5">
                  {d.salesByBrand.map((b, i) => (
                    <li key={b.name} className="flex items-center gap-2.5 text-xs">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white" style={{ background: CHART_SCALE[i % CHART_SCALE.length] }} />
                      <span className="min-w-0 flex-1 truncate font-medium text-neutral-700">{b.name}</span>
                      <span className="tabular text-neutral-500">{brandTotal > 0 ? formatPercent((b.value / brandTotal) * 100) : '—'}</span>
                      <span className="tabular w-20 text-right font-semibold text-neutral-900">{formatCompactINR(b.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Distributors + overdue */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 [&>section]:h-full">
          <ChartCard
            title="Top distributors"
            description="Sales over the last 3 months (excl. GST) against what they currently owe"
            icon={<Users />}
            height={Math.max(240, dists.length * 56)}
            empty={dists.length === 0}
            action={
              <ChartLegend
                items={[
                  { name: 'Sales', color: CHART_COLORS[0] },
                  { name: 'Outstanding', color: CHART_COLORS[3] },
                ]}
              />
            }
          >
            <BarChart data={dists} layout="vertical" margin={{ left: 0, right: 16, top: 4 }} barGap={4}>
              <defs>
                <linearGradient id="dg-bar-sales" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#2a303d" />
                  <stop offset="100%" stopColor="#12151c" />
                </linearGradient>
                <linearGradient id="dg-bar-owed" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#fbbf24" />
                  <stop offset="100%" stopColor="#f59e0b" />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={chartGrid} strokeDasharray="4 6" horizontal={false} />
              <XAxis type="number" tick={chartAxis} tickLine={false} axisLine={false} tickFormatter={formatCompactINR} tickCount={5} />
              <YAxis type="category" dataKey="name" tick={chartAxis} tickLine={false} axisLine={false} width={150} />
              <Tooltip content={<ChartTooltip format={money} colors={{ Sales: CHART_COLORS[0], Outstanding: CHART_COLORS[3] }} />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
              <Bar dataKey="sales" name="Sales" fill="url(#dg-bar-sales)" radius={[0, 8, 8, 0]} barSize={12} />
              <Bar dataKey="outstanding" name="Outstanding" fill="url(#dg-bar-owed)" radius={[0, 8, 8, 0]} barSize={12} />
            </BarChart>
          </ChartCard>
        </div>

        <Panel title="Overdue invoices" icon={<AlertTriangle />} to="/accounts/receivables" empty={d.overdue.length === 0} emptyText="Nothing overdue.">
          {d.overdue.map((i) => (
            <Item key={i.id} to={`/sales/invoices/${i.id}`} icon={<FileText />} tone="danger" title={i.invoiceNo} sub={`${i.distributorName} · due ${formatDate(i.dueDate)}`} right={formatCurrency(i.outstanding)} badge={<Badge tone="danger">{i.daysOverdue}d overdue</Badge>} />
          ))}
        </Panel>
      </div>

      {/* Activity */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.2fr_1fr]">
        <Panel title="Recent invoices" icon={<FileText />} to="/sales/invoices" empty={d.recentInvoices.length === 0}>
          {d.recentInvoices.map((i) => (
            <Item key={i.id} to={`/sales/invoices/${i.id}`} icon={<FileText />} title={i.invoiceNo} sub={`${i.distributorName} · ${formatDate(i.date)}`} right={formatCurrency(i.total)} badge={<StatusBadge status={i.payStatus} />} />
          ))}
        </Panel>
        <Panel title="Expiring & expired batches" icon={<Hourglass />} to="/inventory/batches" empty={d.expiringSoon.length === 0} emptyText="No batches near expiry.">
          {d.expiringSoon.map((b) => (
            <Item
              key={b.id}
              to="/inventory/batches"
              icon={<Hourglass />}
              tone={b.daysToExpiry < 0 ? 'danger' : 'warning'}
              title={b.productName}
              sub={`Batch ${b.batchNo} · ${formatNumber(b.saleable)} units · exp ${formatDate(b.expiryDate)}`}
              right={b.daysToExpiry < 0 ? `${-b.daysToExpiry}d ago` : `${b.daysToExpiry}d left`}
              badge={<StatusBadge status={b.expiryStatus} />}
            />
          ))}
        </Panel>
        <Panel title="Low stock" icon={<PackageX />} to="/inventory" empty={d.lowStock.length === 0} emptyText="All products are above minimum stock.">
          {d.lowStock.map((p) => (
            <Item key={p.productId} to="/inventory" icon={<PackageX />} tone="warning" title={p.name} sub={`${p.sku} · minimum ${formatNumber(p.minStock)}`} right={formatNumber(p.available)} badge={<StatusBadge status={p.stockStatus} />} />
          ))}
        </Panel>
      </div>

      <Link
        to="/distribution/orders"
        className="group flex flex-wrap items-center gap-3 rounded-2xl bg-gradient-to-r from-white via-white to-slate-50 px-5 py-4 text-sm font-medium text-neutral-700 shadow-card ring-1 ring-slate-900/[0.05] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-hover"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-white [&>svg]:h-4 [&>svg]:w-4">
          <ClipboardList />
        </span>
        <span>
          {k.openOrders} open order{k.openOrders === 1 ? '' : 's'} waiting for dispatch
        </span>
        {k.expiredBatches > 0 && (
          <span className="ml-auto flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            {k.expiredBatches} expired batch{k.expiredBatches === 1 ? '' : 'es'} to write off
          </span>
        )}
        <ChevronRight className={cn('h-4 w-4 text-neutral-400 transition-transform group-hover:translate-x-0.5', k.expiredBatches > 0 ? '' : 'ml-auto')} />
      </Link>
    </div>
  );
}

function Panel({ title, icon, to, children, empty, emptyText = 'Nothing to show.' }: { title: string; icon: ReactNode; to: string; children: ReactNode; empty: boolean; emptyText?: string }) {
  return (
    <Card className="flex flex-col">
      <CardHeader
        title={title}
        icon={icon}
        divider={false}
        className="pb-2"
        action={
          <Link to={to} className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-slate-900/[0.05] px-2.5 py-1.5 text-xs font-semibold text-neutral-700 transition-colors hover:bg-slate-900/10 hover:text-neutral-900">
            View all
            <ChevronRight className="h-3 w-3" />
          </Link>
        }
      />
      {empty ? <p className="px-5 pb-8 pt-4 text-center text-sm text-neutral-500">{emptyText}</p> : <ul className="px-2 pb-3">{children}</ul>}
    </Card>
  );
}

const ICON_TONE = { default: 'bg-slate-100 text-neutral-600', danger: 'bg-red-500/10 text-red-600', warning: 'bg-amber-500/15 text-amber-700' } as const;

function Item({ to, title, sub, right, badge, icon, tone = 'default' }: { to: string; title: string; sub: string; right: string; badge: ReactNode; icon: ReactNode; tone?: keyof typeof ICON_TONE }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-slate-50">
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full [&>svg]:h-4 [&>svg]:w-4', ICON_TONE[tone])}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-neutral-900">{title}</span>
          <span className="line-clamp-2 text-xs text-neutral-500">{sub}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="tabular text-sm font-semibold text-neutral-900">{right}</span>
          {badge}
        </span>
      </Link>
    </li>
  );
}
