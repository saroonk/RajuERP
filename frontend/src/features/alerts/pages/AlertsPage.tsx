import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, CheckCircle2, CreditCard, Eye, FileText, Layers, ShoppingCart, Trash2 } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { DataTable, type Column } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { LinkButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, Loadable } from '@/components/ui/States';
import { Tabs } from '@/components/ui/Tabs';
import { cn } from '@/utils/cn';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { BatchStock, DistributorBalance, InvoiceRow, ProductStock } from '@/types';
import { formatCurrency, formatDate, formatNumber, formatPercent } from '@/utils/format';
import { ExpiryDays } from '@/features/inventory/components/ExpiryCell';

type TabKey = 'expiry' | 'low' | 'overdue' | 'credit' | 'inspection';

function AllClear({ title }: { title: string }) {
  return <Card><EmptyState icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />} title="All clear" description={title} /></Card>;
}

export default function AlertsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const alerts = useData(() => services.inventory.alerts());
  const [tab, setTab] = useState<TabKey>('expiry');

  const expiryRows = alerts.data ? [...alerts.data.expired, ...alerts.data.expiring] : [];

  const expiryCols: Column<BatchStock>[] = [
    { key: 'product', header: 'Product', primary: true, value: (b) => b.productName, cell: (b) => <span className="font-medium text-neutral-900">{b.productName}</span> },
    { key: 'batch', header: 'Batch', value: (b) => b.batchNo },
    { key: 'expiry', header: 'Expiry', value: (b) => b.expiryDate, cell: (b) => formatDate(b.expiryDate) },
    { key: 'days', header: 'Status', value: (b) => b.daysToExpiry, cell: (b) => <ExpiryDays days={b.daysToExpiry} status={b.expiryStatus} />, csv: (b) => b.daysToExpiry },
    { key: 'qty', header: 'Units at risk', align: 'right', value: (b) => b.saleable + b.expired, cell: (b) => formatNumber(b.saleable + b.expired) },
    { key: 'value', header: 'Value at cost', align: 'right', value: (b) => (b.saleable + b.expired) * b.costPrice, cell: (b) => formatCurrency((b.saleable + b.expired) * b.costPrice) },
  ];
  const lowCols: Column<ProductStock>[] = [
    { key: 'name', header: 'Product', primary: true, value: (p) => p.name, cell: (p) => <span className="font-medium text-neutral-900">{p.name}</span> },
    { key: 'sku', header: 'SKU', value: (p) => p.sku },
    { key: 'brand', header: 'Brand', value: (p) => p.brandName },
    { key: 'available', header: 'Available', align: 'right', value: (p) => p.available, cell: (p) => formatNumber(p.available) },
    { key: 'min', header: 'Minimum', align: 'right', value: (p) => p.minStock, cell: (p) => formatNumber(p.minStock) },
    { key: 'status', header: 'Status', value: (p) => p.stockStatus, cell: (p) => <StatusBadge status={p.stockStatus} /> },
  ];
  const overdueCols: Column<InvoiceRow>[] = [
    { key: 'inv', header: 'Invoice', primary: true, value: (i) => i.invoiceNo, cell: (i) => <span className="font-medium text-neutral-900">{i.invoiceNo}</span> },
    { key: 'dist', header: 'Distributor', value: (i) => i.distributorName },
    { key: 'due', header: 'Due date', value: (i) => i.dueDate, cell: (i) => formatDate(i.dueDate) },
    { key: 'days', header: 'Days overdue', align: 'right', value: (i) => i.daysOverdue, cell: (i) => <span className="font-medium text-red-600">{i.daysOverdue}</span> },
    { key: 'total', header: 'Invoice total', align: 'right', value: (i) => i.total, cell: (i) => formatCurrency(i.total) },
    { key: 'out', header: 'Outstanding', align: 'right', value: (i) => i.outstanding, cell: (i) => <span className="font-medium">{formatCurrency(i.outstanding)}</span> },
  ];
  const creditCols: Column<DistributorBalance>[] = [
    { key: 'name', header: 'Distributor', primary: true, value: (b) => b.distributorName, cell: (b) => <span className="font-medium text-neutral-900">{b.distributorName}</span> },
    { key: 'code', header: 'Code', value: (b) => b.code },
    { key: 'limit', header: 'Credit limit', align: 'right', value: (b) => b.creditLimit, cell: (b) => formatCurrency(b.creditLimit) },
    { key: 'bal', header: 'Outstanding', align: 'right', value: (b) => b.balance, cell: (b) => formatCurrency(b.balance) },
    { key: 'used', header: 'Limit used', align: 'right', value: (b) => b.creditUsedPct, cell: (b) => <span className="font-medium text-red-600">{formatPercent(b.creditUsedPct, 0)}</span> },
  ];

  return (
    <>
      <PageHeader title="Alerts" description="Expiry, low stock, overdue payments, credit limits and returns that need attention." breadcrumbs={[{ label: 'Overview' }, { label: 'Alerts' }]} />
      <Loadable state={alerts}>
        {(a) => {
          const cards: { key: TabKey; label: string; value: number; tone: string }[] = [
            { key: 'expiry', label: 'Expired stock', value: a.expired.length, tone: 'text-red-600' },
            { key: 'expiry', label: 'Expiring soon', value: a.expiring.length, tone: 'text-amber-700' },
            { key: 'low', label: 'Low / out of stock', value: a.lowStock.length, tone: 'text-amber-700' },
            { key: 'overdue', label: 'Overdue invoices', value: a.overdue.length, tone: 'text-red-600' },
            { key: 'credit', label: 'Over credit limit', value: a.overLimit.length, tone: 'text-red-600' },
            { key: 'inspection', label: 'Returns to inspect', value: a.pendingInspection, tone: 'text-amber-700' },
          ];
          let content: ReactNode;
          if (tab === 'expiry') {
            content = expiryRows.length === 0 ? <AllClear title="No batches are expired or close to expiry." /> : (
              <DataTable
                data={expiryRows}
                columns={expiryCols}
                rowKey={(b) => b.id}
                searchText={(b) => `${b.productName} ${b.batchNo}`}
                exportName="expiry-alerts"
                defaultSort={{ key: 'days', dir: 'asc' }}
                rowActions={(b) => [
                  { label: 'Write off', icon: <Trash2 className="h-4 w-4" />, onClick: () => navigate(`/inventory/write-offs?batch=${b.id}`), hidden: !can('inventory', 'edit') },
                  { label: 'View batch', icon: <Layers className="h-4 w-4" />, onClick: () => navigate(`/inventory/batches?product=${b.productId}`) },
                ]}
              />
            );
          } else if (tab === 'low') {
            content = a.lowStock.length === 0 ? <AllClear title="All products are above their minimum stock." /> : (
              <DataTable
                data={a.lowStock}
                columns={lowCols}
                rowKey={(p) => p.productId}
                searchText={(p) => `${p.name} ${p.sku}`}
                exportName="low-stock-alerts"
                defaultSort={{ key: 'available', dir: 'asc' }}
                rowActions={() => [{ label: 'Create purchase order', icon: <ShoppingCart className="h-4 w-4" />, onClick: () => navigate('/purchases/orders/new'), hidden: !can('purchases', 'edit') }]}
              />
            );
          } else if (tab === 'overdue') {
            content = a.overdue.length === 0 ? <AllClear title="No invoices are past their due date." /> : (
              <DataTable
                data={a.overdue}
                columns={overdueCols}
                rowKey={(i) => i.id}
                searchText={(i) => `${i.invoiceNo} ${i.distributorName}`}
                exportName="overdue-invoices"
                defaultSort={{ key: 'days', dir: 'desc' }}
                rowActions={(i) => [
                  { label: 'Record payment', icon: <CreditCard className="h-4 w-4" />, onClick: () => navigate(`/accounts/payments/new?invoice=${i.id}`), hidden: !can('receivables', 'edit') },
                  { label: 'View invoice', icon: <FileText className="h-4 w-4" />, onClick: () => navigate(`/sales/invoices/${i.id}`) },
                ]}
              />
            );
          } else if (tab === 'credit') {
            content = a.overLimit.length === 0 ? <AllClear title="No distributor has exceeded their credit limit." /> : (
              <DataTable
                data={a.overLimit}
                columns={creditCols}
                rowKey={(b) => b.distributorId}
                searchText={(b) => `${b.distributorName} ${b.code}`}
                exportName="credit-limit-alerts"
                defaultSort={{ key: 'used', dir: 'desc' }}
                rowActions={(b) => [{ label: 'View ledger', icon: <BookOpen className="h-4 w-4" />, onClick: () => navigate(`/accounts/ledger/${b.distributorId}`) }]}
              />
            );
          } else {
            content = a.pendingInspection === 0 ? <AllClear title="No returned stock is waiting for an inspection decision." /> : (
              <Card>
                <EmptyState
                  icon={<Eye className="h-5 w-5" />}
                  title={`${a.pendingInspection} returned line${a.pendingInspection > 1 ? 's' : ''} awaiting inspection`}
                  description="Returned goods held for inspection are not saleable until a disposition is recorded."
                  action={<LinkButton to="/sales/returns">Open sales returns</LinkButton>}
                />
              </Card>
            );
          }
          return (
            <>
              <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-6">
                {cards.map((c) => (
                  <button key={c.label} type="button" onClick={() => setTab(c.key)} className={cn('rounded-2xl bg-white p-4 text-left shadow-card ring-1 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-hover', tab === c.key ? 'ring-2 ring-neutral-900' : 'ring-slate-900/[0.05]')}>
                    <p className="text-xs font-medium text-neutral-500">{c.label}</p>
                    <p className={cn('tabular mt-1.5 text-2xl font-semibold tracking-tight', c.value > 0 ? c.tone : 'text-neutral-900')}>{c.value}</p>
                  </button>
                ))}
              </div>
              <Tabs
                className="mb-4"
                value={tab}
                onChange={(k) => setTab(k as TabKey)}
                tabs={[
                  { key: 'expiry', label: 'Expiry', count: expiryRows.length },
                  { key: 'low', label: 'Low stock', count: a.lowStock.length },
                  { key: 'overdue', label: 'Overdue payments', count: a.overdue.length },
                  { key: 'credit', label: 'Credit limit', count: a.overLimit.length },
                  { key: 'inspection', label: 'Pending inspection', count: a.pendingInspection },
                ]}
              />
              {content}
            </>
          );
        }}
      </Loadable>
    </>
  );
}
