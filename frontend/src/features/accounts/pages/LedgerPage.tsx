import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BookOpen, Printer } from 'lucide-react';
import { DataTable, type Column } from '@/components/data/DataTable';
import { DateRangeFilter, rangeFor } from '@/components/data/DateRangeFilter';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/ui/Card';
import { Field, Select } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/States';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { DateRange, LedgerEntry } from '@/types';
import { cn } from '@/utils/cn';
import { formatCurrency, formatDate } from '@/utils/format';

type Row = Omit<LedgerEntry, 'type'> & { key: string; type: LedgerEntry['type'] | 'opening' };

const TYPE_LABEL: Record<Row['type'], { label: string; tone: 'info' | 'success' | 'warning' | 'neutral' | 'dark' }> = {
  invoice: { label: 'Invoice', tone: 'dark' },
  payment: { label: 'Payment', tone: 'success' },
  credit_note: { label: 'Credit note', tone: 'info' },
  debit_note: { label: 'Debit note', tone: 'warning' },
  opening: { label: 'Opening', tone: 'neutral' },
};

export default function LedgerPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const lookups = useLookups();
  const [range, setRange] = useState<DateRange>(rangeFor('last_6m'));
  const ledger = useData(() => (id ? services.accounts.ledger(id) : Promise.resolve([])), [id]);
  const balances = useData(() => services.accounts.balances());
  const dist = lookups.distributor(id);
  const bal = balances.data?.find((b) => b.distributorId === id);

  const rows = useMemo<Row[]>(() => {
    const all = ledger.data ?? [];
    const before = all.filter((e) => e.date < range.from);
    const inside = all.filter((e) => e.date >= range.from && e.date <= range.to);
    const opening = before.length ? before[before.length - 1].balance : 0;
    const out: Row[] = [];
    if (before.length) out.push({ key: 'opening', date: range.from, type: 'opening', ref: '', refId: '', description: `Opening balance (${before.length} earlier entries)`, debit: 0, credit: 0, balance: opening });
    inside.forEach((e, i) => out.push({ ...e, key: `${e.refId}-${i}` }));
    return out;
  }, [ledger.data, range]);

  const columns: Column<Row>[] = [
    { key: 'date', header: 'Date', cell: (r) => formatDate(r.date), csv: (r) => r.date },
    { key: 'type', header: 'Type', cell: (r) => <Badge tone={TYPE_LABEL[r.type].tone}>{TYPE_LABEL[r.type].label}</Badge>, csv: (r) => TYPE_LABEL[r.type].label },
    {
      key: 'ref',
      header: 'Reference',
      primary: true,
      cell: (r) =>
        r.type === 'invoice' ? (
          <Link to={`/sales/invoices/${r.refId}`} className="font-medium hover:underline">{r.ref}</Link>
        ) : r.type === 'payment' ? (
          <Link to={`/accounts/payments/${r.refId}`} className="font-medium hover:underline">{r.ref}</Link>
        ) : (
          <span className="font-medium">{r.ref || '—'}</span>
        ),
      csv: (r) => r.ref,
    },
    { key: 'desc', header: 'Description', cell: (r) => <span className="text-neutral-600">{r.description}</span>, csv: (r) => r.description, className: 'max-w-md' },
    { key: 'debit', header: 'Debit', align: 'right', cell: (r) => (r.debit ? formatCurrency(r.debit) : '—'), csv: (r) => r.debit },
    { key: 'credit', header: 'Credit', align: 'right', cell: (r) => (r.credit ? formatCurrency(r.credit) : '—'), csv: (r) => r.credit },
    { key: 'balance', header: 'Balance', align: 'right', cell: (r) => <span className="font-semibold">{formatCurrency(r.balance)}</span>, csv: (r) => r.balance },
  ];

  return (
    <>
      <PageHeader
        title="Distributor ledger"
        description="Invoices, receipts, credit and debit notes with a running balance."
        breadcrumbs={[{ label: 'Accounts' }, { label: 'Distributor ledger' }]}
        actions={
          id && (
            <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
              Print
            </Button>
          )
        }
      />
      <div className="no-print mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <Field label="Distributor / dealer">
          <Select value={id ?? ''} onChange={(e) => navigate(e.target.value ? `/accounts/ledger/${e.target.value}` : '/accounts/ledger')} placeholder="Select a distributor…" options={lookups.distributors.map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }))} />
        </Field>
        <div>
          <span className="mb-1 block text-xs font-medium text-neutral-700">Period</span>
          <DateRangeFilter value={range} onChange={setRange} />
        </div>
      </div>

      {!id ? (
        <div className="surface">
          <EmptyState icon={<BookOpen className="h-5 w-5" />} title="Select a distributor" description="Choose a distributor or dealer above to see their ledger." />
        </div>
      ) : (
        <div className="print-area">
          <p className="print-only mb-3 text-base font-semibold">
            Ledger: {dist?.name} ({formatDate(range.from)} to {formatDate(range.to)})
          </p>
          <div className="no-print mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Closing balance" value={formatCurrency(bal?.balance)} hint="Receivable from distributor" tone={bal && bal.balance < 0 ? 'success' : 'default'} />
            <StatCard label="Credit limit" value={formatCurrency(bal?.creditLimit)} hint={bal ? `${bal.creditUsedPct}% used` : undefined} tone={bal?.overLimit ? 'danger' : 'default'} />
            <StatCard label="Overdue" value={formatCurrency(bal?.overdueAmount)} hint={bal ? `${bal.overdueInvoices} invoices` : undefined} tone={bal && bal.overdueAmount > 0 ? 'danger' : 'default'} />
            <StatCard label="Last payment" value={formatDate(bal?.lastPaymentDate)} hint={bal && bal.unallocated > 0 ? `${formatCurrency(bal.unallocated)} unallocated` : undefined} />
          </div>
          <DataTable
            data={rows}
            columns={columns}
            rowKey={(r) => r.key}
            loading={ledger.loading}
            error={ledger.error}
            onRetry={ledger.reload}
            pageSize={50}
            exportName={`ledger-${dist?.code ?? id}`}
            emptyTitle="No ledger entries"
            emptyDescription="This distributor has no transactions yet."
            summary={(all) => {
              const debit = all.reduce((s, r) => s + r.debit, 0);
              const credit = all.reduce((s, r) => s + r.credit, 0);
              return (
                <div className={cn('flex flex-wrap items-center justify-between gap-2')}>
                  <span className="text-neutral-600">Period totals</span>
                  <span className="tabular">
                    Debit {formatCurrency(debit)} · Credit {formatCurrency(credit)}
                  </span>
                </div>
              );
            }}
          />
        </div>
      )}
    </>
  );
}
