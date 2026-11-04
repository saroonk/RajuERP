import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, BookOpen, CreditCard, FileText, Wallet } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { DataTable, type Column } from '@/components/data/DataTable';
import { StatCard } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Checkbox, FilterSelect } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { DistributorBalance, InvoiceRow } from '@/types';
import { cn } from '@/utils/cn';
import { daysBetween, formatCurrency, formatDate, formatNumber, today } from '@/utils/format';

function CreditBar({ b }: { b: DistributorBalance }) {
  const pct = Math.min(100, b.creditUsedPct);
  return (
    <div className="min-w-[8rem]">
      <div className="flex items-center justify-between text-xs">
        <span className="tabular text-neutral-600">{formatCurrency(b.creditLimit)}</span>
        <span className={cn('tabular font-medium', b.overLimit ? 'text-red-600' : 'text-neutral-700')}>{b.creditUsedPct}%</span>
      </div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-neutral-100" role="progressbar" aria-valuenow={b.creditUsedPct} aria-valuemin={0} aria-valuemax={100} aria-label="Credit used">
        <div className={cn('h-1.5 rounded-full', b.overLimit ? 'bg-red-600' : b.creditUsedPct >= 80 ? 'bg-amber-500' : 'bg-neutral-900')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function ReceivablesPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canEdit = can('receivables', 'edit');
  const [tab, setTab] = useState('balances');
  const balances = useData(() => services.accounts.balances());
  const invoices = useData(() => services.sales.invoices.list());

  const [type, setType] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [overLimitOnly, setOverLimitOnly] = useState(false);
  const [dueFilter, setDueFilter] = useState('open');

  const b = useMemo(() => balances.data ?? [], [balances.data]);
  const totalOutstanding = b.reduce((s, x) => s + Math.max(0, x.balance), 0);
  const overdue = b.reduce((s, x) => s + x.overdueAmount, 0);
  const unallocated = b.reduce((s, x) => s + x.unallocated, 0);
  const overLimit = b.filter((x) => x.overLimit).length;

  const filteredBalances = useMemo(() => b.filter((x) => (!type || x.type === type) && (!overdueOnly || x.overdueAmount > 0) && (!overLimitOnly || x.overLimit)), [b, type, overdueOnly, overLimitOnly]);

  const now = today();
  const open = useMemo(
    () =>
      (invoices.data ?? [])
        .filter((i) => i.outstanding > 0.005)
        .filter((i) => dueFilter === 'open' || (dueFilter === 'overdue' ? i.overdue : !i.overdue && daysBetween(now, i.dueDate) <= 7))
        .sort((a, c) => a.dueDate.localeCompare(c.dueDate)),
    [invoices.data, dueFilter, now],
  );

  const balanceColumns: Column<DistributorBalance>[] = [
    { key: 'code', header: 'Code', value: (r) => r.code, hideOnMobile: true },
    { key: 'name', header: 'Distributor', value: (r) => r.distributorName, primary: true, cell: (r) => <span className="font-medium">{r.distributorName}</span> },
    { key: 'type', header: 'Type', value: (r) => r.type, cell: (r) => <StatusBadge status={r.type} /> },
    { key: 'invoiced', header: 'Invoiced', align: 'right', value: (r) => r.invoiced, cell: (r) => formatCurrency(r.invoiced) },
    { key: 'cn', header: 'Credit notes', align: 'right', value: (r) => r.creditNotes, cell: (r) => formatCurrency(r.creditNotes) },
    { key: 'dn', header: 'Debit notes', align: 'right', value: (r) => r.debitNotes, cell: (r) => formatCurrency(r.debitNotes) },
    { key: 'received', header: 'Received', align: 'right', value: (r) => r.received, cell: (r) => formatCurrency(r.received) },
    { key: 'balance', header: 'Balance', align: 'right', value: (r) => r.balance, cell: (r) => <span className={cn('font-semibold', r.balance < 0 && 'text-emerald-700')}>{formatCurrency(r.balance)}</span> },
    { key: 'overdue', header: 'Overdue', align: 'right', value: (r) => r.overdueAmount, cell: (r) => <span className={cn(r.overdueAmount > 0 && 'text-red-600')}>{formatCurrency(r.overdueAmount)}</span> },
    { key: 'limit', header: 'Credit limit used', value: (r) => r.creditUsedPct, cell: (r) => <CreditBar b={r} />, csv: (r) => `${r.creditLimit} (${r.creditUsedPct}%)` },
    { key: 'last', header: 'Last payment', value: (r) => r.lastPaymentDate, cell: (r) => formatDate(r.lastPaymentDate) },
  ];

  const invoiceColumns: Column<InvoiceRow>[] = [
    { key: 'no', header: 'Invoice', value: (r) => r.invoiceNo, primary: true, cell: (r) => <span className="font-medium">{r.invoiceNo}</span> },
    { key: 'dist', header: 'Distributor', value: (r) => r.distributorName },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date) },
    { key: 'due', header: 'Due date', value: (r) => r.dueDate, cell: (r) => formatDate(r.dueDate) },
    {
      key: 'days',
      header: 'Status',
      value: (r) => (r.overdue ? r.daysOverdue : -daysBetween(now, r.dueDate)),
      cell: (r) => (r.overdue ? <Badge tone="danger">{r.daysOverdue}d overdue</Badge> : <Badge tone="neutral">Due in {daysBetween(now, r.dueDate)}d</Badge>),
      csv: (r) => (r.overdue ? `${r.daysOverdue} days overdue` : `Due in ${daysBetween(now, r.dueDate)} days`),
    },
    { key: 'total', header: 'Invoice total', align: 'right', value: (r) => r.total, cell: (r) => formatCurrency(r.total) },
    { key: 'out', header: 'Outstanding', align: 'right', value: (r) => r.outstanding, cell: (r) => <span className="font-semibold">{formatCurrency(r.outstanding)}</span> },
  ];

  return (
    <>
      <PageHeader title="Receivables" description="Outstanding balances, credit utilisation and due or overdue invoices for every distributor and dealer." breadcrumbs={[{ label: 'Accounts' }, { label: 'Receivables' }]} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total outstanding" value={formatCurrency(totalOutstanding)} icon={<Wallet className="h-4 w-4" />} />
        <StatCard label="Overdue" value={formatCurrency(overdue)} tone={overdue > 0 ? 'danger' : 'default'} icon={<AlertTriangle className="h-4 w-4" />} hint={`${(invoices.data ?? []).filter((i) => i.overdue).length} overdue invoices`} />
        <StatCard label="Unallocated receipts" value={formatCurrency(unallocated)} icon={<CreditCard className="h-4 w-4" />} to="/accounts/payments" hint="Payments kept on account" />
        <StatCard label="Over credit limit" value={formatNumber(overLimit)} tone={overLimit > 0 ? 'warning' : 'default'} hint="Distributors above their limit" />
      </div>

      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'balances', label: 'Distributor balances', count: b.length },
          { key: 'invoices', label: 'Due & overdue invoices', count: (invoices.data ?? []).filter((i) => i.outstanding > 0.005).length },
        ]}
      />

      {tab === 'balances' ? (
        <DataTable
          data={filteredBalances}
          columns={balanceColumns}
          rowKey={(r) => r.distributorId}
          loading={balances.loading}
          error={balances.error}
          onRetry={balances.reload}
          searchText={(r) => `${r.code} ${r.distributorName}`}
          searchPlaceholder="Search distributors…"
          exportName="receivables-balances"
          defaultSort={{ key: 'balance', dir: 'desc' }}
          emptyTitle="No distributors found"
          filters={
            <>
              <FilterSelect value={type} onChange={setType} allLabel="All types" options={[{ value: 'distributor', label: 'Distributors' }, { value: 'dealer', label: 'Dealers' }]} />
              <Checkbox label="Overdue only" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
              <Checkbox label="Over limit only" checked={overLimitOnly} onChange={(e) => setOverLimitOnly(e.target.checked)} />
            </>
          }
          onRowClick={(r) => navigate(`/accounts/ledger/${r.distributorId}`)}
          rowActions={(r) => [
            { label: 'View ledger', icon: <BookOpen className="h-4 w-4" />, onClick: () => navigate(`/accounts/ledger/${r.distributorId}`) },
            { label: 'Record payment', icon: <CreditCard className="h-4 w-4" />, onClick: () => navigate(`/accounts/payments/new?distributor=${r.distributorId}`), hidden: !canEdit },
            { label: 'View invoices', icon: <FileText className="h-4 w-4" />, onClick: () => navigate(`/sales/invoices?distributor=${r.distributorId}`) },
          ]}
        />
      ) : (
        <DataTable
          data={open}
          columns={invoiceColumns}
          rowKey={(r) => r.id}
          loading={invoices.loading}
          error={invoices.error}
          onRetry={invoices.reload}
          searchText={(r) => `${r.invoiceNo} ${r.distributorName}`}
          searchPlaceholder="Search invoices…"
          exportName="due-and-overdue-invoices"
          emptyTitle="Nothing to collect"
          emptyDescription="No invoices match this filter."
          filters={
            <FilterSelectAll value={dueFilter} onChange={setDueFilter} />
          }
          onRowClick={(r) => navigate(`/sales/invoices/${r.id}`)}
          rowActions={(r) => [
            { label: 'View invoice', icon: <FileText className="h-4 w-4" />, onClick: () => navigate(`/sales/invoices/${r.id}`) },
            { label: 'Record payment', icon: <CreditCard className="h-4 w-4" />, onClick: () => navigate(`/accounts/payments/new?invoice=${r.id}`), hidden: !canEdit },
          ]}
          summary={(rows) => (
            <div className="flex items-center justify-between">
              <span className="text-neutral-600">{rows.length} invoices</span>
              <span className="tabular font-semibold">{formatCurrency(rows.reduce((s, r) => s + r.outstanding, 0))} outstanding</span>
            </div>
          )}
        />
      )}
    </>
  );
}

/** Due filter without an "all" empty value: "open" is the unfiltered state. */
function FilterSelectAll({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select aria-label="Due filter" value={value} onChange={(e) => onChange(e.target.value)} className="block h-10 w-full rounded-xl bg-white shadow-sm ring-1 ring-slate-900/10 px-3 pr-8 text-sm md:h-9 sm:w-auto">
      <option value="open">All open</option>
      <option value="overdue">Overdue</option>
      <option value="week">Due in next 7 days</option>
    </select>
  );
}
