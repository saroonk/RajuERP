import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BookOpen, ClipboardList } from 'lucide-react';
import { DataTable, type Column } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { LinkButton } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DescriptionList, StatCard } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Loadable } from '@/components/ui/States';
import { Tabs } from '@/components/ui/Tabs';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { DistributionOrderRow, Distributor, DistributorBalance, DistributorPrice, DistributorStockRow, InvoiceRow } from '@/types';
import { cn } from '@/utils/cn';
import { formatCurrency, formatDate, formatNumber, formatPercent, round2 } from '@/utils/format';

export default function DistributorDetailPage() {
  const { id = '' } = useParams();
  const state = useData(() => services.distributors.get(id), [id]);
  return <Loadable state={state}>{(d) => <Detail d={d} />}</Loadable>;
}

function Detail({ d }: { d: Distributor }) {
  const [tab, setTab] = useState('overview');
  const lk = useLookups();
  const balances = useData(() => services.accounts.balances());
  const prices = useData(() => services.distributorPrices.list());
  const orders = useData(() => services.distribution.orders.list());
  const invoices = useData(() => services.sales.invoices.list());
  const stock = useData(() => services.distribution.stock());

  const bal: DistributorBalance | undefined = balances.data?.find((b) => b.distributorId === d.id);
  const myPrices = prices.data?.filter((p) => p.distributorId === d.id);
  const myOrders = orders.data?.filter((o) => o.distributorId === d.id);
  const myInvoices = invoices.data?.filter((i) => i.distributorId === d.id);
  const myStock = stock.data?.filter((s) => s.distributorId === d.id);
  const used = bal ? Math.max(0, bal.balance) : 0;
  const pct = d.creditLimit ? Math.min(100, Math.round((used / d.creditLimit) * 100)) : 0;

  const priceCols: Column<DistributorPrice>[] = [
    { key: 'p', header: 'Product', value: (r) => lk.productName(r.productId), primary: true },
    { key: 'std', header: 'Standard', align: 'right', value: (r) => lk.product(r.productId)?.sellingPrice ?? 0, cell: (r) => formatCurrency(lk.product(r.productId)?.sellingPrice) },
    { key: 'price', header: 'Special price', align: 'right', value: (r) => r.price, cell: (r) => formatCurrency(r.price) },
    { key: 'disc', header: 'Discount', align: 'right', value: (r) => r.discountPct, cell: (r) => formatPercent(r.discountPct) },
    { key: 'net', header: 'Effective net', align: 'right', value: (r) => round2(r.price * (1 - r.discountPct / 100)), cell: (r) => formatCurrency(round2(r.price * (1 - r.discountPct / 100))) },
    { key: 'terms', header: 'Terms', value: (r) => r.terms },
  ];
  const orderCols: Column<DistributionOrderRow>[] = [
    { key: 'no', header: 'Order', value: (r) => r.orderNo, cell: (r) => <Link className="font-medium hover:underline" to={`/distribution/orders/${r.id}`}>{r.orderNo}</Link>, primary: true },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date) },
    { key: 'total', header: 'Total', align: 'right', value: (r) => r.total, cell: (r) => formatCurrency(r.total) },
    { key: 'status', header: 'Status', value: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'pct', header: 'Dispatched', align: 'right', value: (r) => r.dispatchedPct, cell: (r) => formatPercent(r.dispatchedPct, 0) },
  ];
  const invoiceCols: Column<InvoiceRow>[] = [
    { key: 'no', header: 'Invoice', value: (r) => r.invoiceNo, cell: (r) => <Link className="font-medium hover:underline" to={`/sales/invoices/${r.id}`}>{r.invoiceNo}</Link>, primary: true },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date) },
    { key: 'due', header: 'Due', value: (r) => r.dueDate, cell: (r) => formatDate(r.dueDate) },
    { key: 'total', header: 'Total', align: 'right', value: (r) => r.total, cell: (r) => formatCurrency(r.total) },
    { key: 'out', header: 'Outstanding', align: 'right', value: (r) => r.outstanding, cell: (r) => formatCurrency(r.outstanding) },
    { key: 'st', header: 'Status', value: (r) => r.payStatus, cell: (r) => (r.overdue ? <StatusBadge status="overdue" /> : <StatusBadge status={r.payStatus} />) },
  ];
  const stockCols: Column<DistributorStockRow>[] = [
    { key: 'p', header: 'Product', value: (r) => r.productName, primary: true },
    { key: 'd', header: 'Dispatched', align: 'right', value: (r) => r.dispatched, cell: (r) => formatNumber(r.dispatched) },
    { key: 'r', header: 'Returned', align: 'right', value: (r) => r.returnedToUs, cell: (r) => formatNumber(r.returnedToUs) },
    { key: 's', header: 'Reported sales', align: 'right', value: (r) => r.reportedSales, cell: (r) => (r.reportedSales === null ? 'Not reported' : formatNumber(r.reportedSales)) },
    { key: 'rem', header: 'Reported remaining', align: 'right', value: (r) => r.reportedRemaining, cell: (r) => (r.reportedRemaining === null ? 'Not reported' : formatNumber(r.reportedRemaining)) },
  ];

  return (
    <>
      <PageHeader
        title={d.name}
        meta={<><StatusBadge status={d.type} />{!d.active && <StatusBadge status="inactive" />}</>}
        description={`${d.code} · ${d.city}, ${d.state}`}
        breadcrumbs={[{ label: 'Distributors & dealers', to: '/distribution/distributors' }, { label: d.name }]}
        actions={
          <>
            <LinkButton variant="secondary" to={`/accounts/ledger/${d.id}`} icon={<BookOpen className="h-4 w-4" />}>Ledger</LinkButton>
            {d.active && <LinkButton to={`/distribution/orders/new?distributor=${d.id}`} icon={<ClipboardList className="h-4 w-4" />}>New order</LinkButton>}
          </>
        }
      />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[{ key: 'overview', label: 'Overview' }, { key: 'pricing', label: 'Pricing', count: myPrices?.length }, { key: 'orders', label: 'Orders', count: myOrders?.length }, { key: 'invoices', label: 'Invoices', count: myInvoices?.length }, { key: 'stock', label: 'Stock' }]}
      />

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Outstanding balance" value={formatCurrency(bal?.balance ?? 0)} tone={bal && bal.balance > 0 ? 'default' : 'success'} />
            <StatCard label="Overdue" value={formatCurrency(bal?.overdueAmount ?? 0)} hint={`${bal?.overdueInvoices ?? 0} invoices`} tone={bal && bal.overdueAmount > 0 ? 'danger' : 'default'} />
            <StatCard label="Credit limit" value={formatCurrency(d.creditLimit)} hint={`${d.creditDays} credit days`} />
            <StatCard label="Unallocated receipts" value={formatCurrency(bal?.unallocated ?? 0)} />
          </div>
          <Card>
            <CardHeader title="Credit utilisation" />
            <CardBody>
              <div className="mb-1 flex justify-between text-xs text-neutral-500">
                <span>{formatCurrency(used)} used</span>
                <span className={cn(bal?.overLimit && 'font-medium text-red-600')}>{bal?.overLimit ? `Over limit by ${formatCurrency(used - d.creditLimit)}` : `${pct}% of ${formatCurrency(d.creditLimit)}`}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-neutral-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Credit used">
                <div className={cn('h-full rounded-full', bal?.overLimit ? 'bg-red-600' : pct > 80 ? 'bg-amber-500' : 'bg-neutral-900')} style={{ width: `${pct}%` }} />
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Profile" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Contact person', value: d.contactPerson || '—' },
                  { label: 'Phone', value: d.phone || '—' },
                  { label: 'Email', value: d.email || '—' },
                  { label: 'GSTIN', value: d.gstin || '—' },
                  { label: 'Address', value: [d.address, d.city, d.state].filter(Boolean).join(', ') },
                  { label: 'Payment terms', value: d.paymentTerms || '—' },
                ]}
              />
            </CardBody>
          </Card>
        </div>
      )}
      {tab === 'pricing' && <DataTable data={myPrices} columns={priceCols} rowKey={(r) => r.id} loading={prices.loading} pageSize={10} emptyTitle="No special pricing" emptyDescription="This distributor buys at standard prices. Add specific prices under Pricing & terms." emptyAction={<LinkButton variant="secondary" to="/distribution/pricing">Open pricing</LinkButton>} />}
      {tab === 'orders' && <DataTable data={myOrders} columns={orderCols} rowKey={(r) => r.id} loading={orders.loading} defaultSort={{ key: 'date', dir: 'desc' }} pageSize={10} emptyTitle="No orders yet" />}
      {tab === 'invoices' && <DataTable data={myInvoices} columns={invoiceCols} rowKey={(r) => r.id} loading={invoices.loading} defaultSort={{ key: 'date', dir: 'desc' }} pageSize={10} emptyTitle="No invoices yet" />}
      {tab === 'stock' && (
        <div className="space-y-3">
          <p className="rounded-xl bg-slate-50/80 ring-1 ring-slate-900/[0.04] p-3 text-xs text-neutral-600">Dispatched quantities are not distributor sales. Sales and remaining stock appear only when the distributor reports them.</p>
          <DataTable data={myStock} columns={stockCols} rowKey={(r) => r.productId} loading={stock.loading} pageSize={10} searchText={(r) => r.productName} emptyTitle="Nothing dispatched yet" />
        </div>
      )}
    </>
  );
}
