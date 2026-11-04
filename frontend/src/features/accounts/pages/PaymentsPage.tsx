import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Plus, Split } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { DataTable, type Column } from '@/components/data/DataTable';
import { DateRangeFilter, rangeFor } from '@/components/data/DateRangeFilter';
import { Badge } from '@/components/ui/Badge';
import { LinkButton } from '@/components/ui/Button';
import { FilterSelect } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { DateRange, PaymentRow } from '@/types';
import { formatCurrency, formatDate, inRange, titleCase } from '@/utils/format';
import { AllocationModal } from '../components/AllocationModal';
import { PAYMENT_MODES } from '../constants';

export default function PaymentsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canEdit = can('receivables', 'edit');
  const payments = useData(() => services.accounts.payments.list());
  const lookups = useLookups();
  const [distributor, setDistributor] = useState('');
  const [mode, setMode] = useState('');
  const [range, setRange] = useState<DateRange>(rangeFor('last_6m'));
  const [allocating, setAllocating] = useState<PaymentRow | null>(null);

  const rows = useMemo(
    () => (payments.data ?? []).filter((p) => (!distributor || p.distributorId === distributor) && (!mode || p.mode === mode) && inRange(p.date, range.from, range.to)),
    [payments.data, distributor, mode, range],
  );

  const columns: Column<PaymentRow>[] = [
    { key: 'no', header: 'Receipt', value: (r) => r.receiptNo, primary: true, cell: (r) => <span className="font-medium">{r.receiptNo}</span> },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date) },
    { key: 'dist', header: 'Distributor', value: (r) => r.distributorName },
    { key: 'mode', header: 'Mode', value: (r) => titleCase(r.mode) },
    { key: 'ref', header: 'Reference', value: (r) => r.reference, hideOnMobile: true },
    { key: 'amount', header: 'Amount', align: 'right', value: (r) => r.amount, cell: (r) => <span className="font-semibold">{formatCurrency(r.amount)}</span> },
    { key: 'alloc', header: 'Allocated', align: 'right', value: (r) => r.allocated, cell: (r) => formatCurrency(r.allocated) },
    {
      key: 'unalloc',
      header: 'Unallocated',
      align: 'right',
      value: (r) => r.unallocated,
      cell: (r) => (r.unallocated > 0.005 ? <span className="inline-flex items-center gap-1.5">{formatCurrency(r.unallocated)} <Badge tone="warning">On account</Badge></span> : formatCurrency(0)),
    },
  ];

  return (
    <>
      <PageHeader
        title="Payments received"
        description="Cash, bank transfer, UPI and cheque collections, with invoice-wise allocation."
        breadcrumbs={[{ label: 'Accounts' }, { label: 'Payments received' }]}
        actions={
          canEdit && (
            <LinkButton to="/accounts/payments/new" icon={<Plus className="h-4 w-4" />}>
              Record payment
            </LinkButton>
          )
        }
      />
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={payments.loading}
        error={payments.error}
        onRetry={payments.reload}
        searchText={(r) => `${r.receiptNo} ${r.distributorName} ${r.reference}`}
        searchPlaceholder="Search receipts…"
        exportName="payments-received"
        defaultSort={{ key: 'date', dir: 'desc' }}
        emptyTitle="No payments recorded"
        emptyDescription="Recorded collections will appear here."
        emptyAction={canEdit ? <LinkButton to="/accounts/payments/new">Record payment</LinkButton> : undefined}
        filters={
          <>
            <FilterSelect value={distributor} onChange={setDistributor} allLabel="All distributors" options={lookups.distributors.map((d) => ({ value: d.id, label: d.name }))} />
            <FilterSelect value={mode} onChange={setMode} allLabel="All modes" options={PAYMENT_MODES} />
            <DateRangeFilter value={range} onChange={setRange} />
          </>
        }
        onRowClick={(r) => navigate(`/accounts/payments/${r.id}`)}
        rowActions={(r) => [
          { label: 'View receipt', icon: <Eye className="h-4 w-4" />, onClick: () => navigate(`/accounts/payments/${r.id}`) },
          { label: 'Allocate to invoices', icon: <Split className="h-4 w-4" />, onClick: () => setAllocating(r), hidden: !canEdit || r.unallocated <= 0.005 },
        ]}
        summary={(all) => (
          <div className="flex items-center justify-between">
            <span className="text-neutral-600">{all.length} receipts</span>
            <span className="tabular font-semibold">{formatCurrency(all.reduce((s, r) => s + r.amount, 0))} received</span>
          </div>
        )}
      />
      <AllocationModal payment={allocating} onClose={() => setAllocating(null)} />
    </>
  );
}
