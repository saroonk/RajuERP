import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CreditCard, Eye, FilePlus2, Printer, RotateCcw } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { DataTable, type Column } from '@/components/data/DataTable';
import { DateRangeFilter, defaultRange } from '@/components/data/DateRangeFilter';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, FilterSelect, Input, Select } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { DateRange, InvoiceRow } from '@/types';
import { formatCurrency, formatDate, formatNumber, inRange, today } from '@/utils/format';

const gst = (i: InvoiceRow) => i.cgst + i.sgst + i.igst;

export default function InvoicesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const lookups = useLookups();
  const list = useData(() => services.sales.invoices.list());
  const [status, setStatus] = useState('');
  const [distributor, setDistributor] = useState('');
  const [range, setRange] = useState<DateRange>(defaultRange());
  const [generating, setGenerating] = useState(false);
  const canEdit = can('sales', 'edit');

  const rows = useMemo(
    () =>
      list.data?.filter(
        (i) =>
          inRange(i.date, range.from, range.to) &&
          (!distributor || i.distributorId === distributor) &&
          (!status || (status === 'overdue' ? i.overdue : i.payStatus === status)),
      ),
    [list.data, status, distributor, range],
  );

  const columns: Column<InvoiceRow>[] = [
    { key: 'no', header: 'Invoice no', primary: true, value: (r) => r.invoiceNo, cell: (r) => <Link to={`/sales/invoices/${r.id}`} className="font-medium hover:underline">{r.invoiceNo}</Link> },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date) },
    { key: 'dist', header: 'Distributor', value: (r) => r.distributorName },
    { key: 'taxable', header: 'Taxable', align: 'right', value: (r) => r.taxable, cell: (r) => formatCurrency(r.taxable), hideOnMobile: true },
    { key: 'gst', header: 'GST', align: 'right', value: gst, cell: (r) => formatCurrency(gst(r)), hideOnMobile: true },
    { key: 'total', header: 'Total', align: 'right', value: (r) => r.total, cell: (r) => formatCurrency(r.total) },
    { key: 'paid', header: 'Paid', align: 'right', value: (r) => r.paid, cell: (r) => formatCurrency(r.paid), hideOnMobile: true },
    { key: 'out', header: 'Outstanding', align: 'right', value: (r) => r.outstanding, cell: (r) => formatCurrency(r.outstanding) },
    { key: 'due', header: 'Due date', value: (r) => r.dueDate, cell: (r) => formatDate(r.dueDate) },
    {
      key: 'status',
      header: 'Status',
      value: (r) => (r.overdue ? 'overdue' : r.payStatus),
      cell: (r) => (
        <span className="flex flex-wrap gap-1">
          <StatusBadge status={r.payStatus} />
          {r.overdue && <Badge tone="danger">Overdue {r.daysOverdue}d</Badge>}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Sales invoices"
        description="GST tax invoices raised for distributor and dealer dispatches."
        actions={canEdit && <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setGenerating(true)}>Generate invoice</Button>}
      />
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        searchText={(r) => `${r.invoiceNo} ${r.distributorName} ${r.orderNo} ${r.dispatchNo}`}
        searchPlaceholder="Search invoices…"
        exportName="sales-invoices"
        defaultSort={{ key: 'date', dir: 'desc' }}
        emptyTitle="No invoices yet"
        emptyDescription="Invoices are generated from dispatched orders."
        onRowClick={(r) => navigate(`/sales/invoices/${r.id}`)}
        filters={
          <>
            <DateRangeFilter value={range} onChange={setRange} />
            <FilterSelect value={status} onChange={setStatus} allLabel="All statuses" options={[{ value: 'unpaid', label: 'Unpaid' }, { value: 'partial', label: 'Partially paid' }, { value: 'paid', label: 'Paid' }, { value: 'overdue', label: 'Overdue' }]} />
            <FilterSelect value={distributor} onChange={setDistributor} allLabel="All distributors" options={lookups.distributors.map((d) => ({ value: d.id, label: d.name }))} />
          </>
        }
        summary={(r) => (
          <div className="flex flex-wrap justify-between gap-x-6 gap-y-1">
            <span>{formatNumber(r.length)} invoices</span>
            <span>Invoiced: <b className="tabular">{formatCurrency(r.reduce((s, i) => s + i.total, 0))}</b></span>
            <span>Outstanding: <b className="tabular">{formatCurrency(r.reduce((s, i) => s + i.outstanding, 0))}</b></span>
          </div>
        )}
        rowActions={(i) => [
          { label: 'View', icon: <Eye className="h-4 w-4" />, onClick: () => navigate(`/sales/invoices/${i.id}`) },
          { label: 'Record payment', icon: <CreditCard className="h-4 w-4" />, onClick: () => navigate(`/accounts/payments/new?invoice=${i.id}`), hidden: i.payStatus === 'paid' || !can('receivables', 'edit') },
          { label: 'Return goods', icon: <RotateCcw className="h-4 w-4" />, onClick: () => navigate(`/sales/returns/new?invoice=${i.id}`), hidden: !canEdit },
          { label: 'Print', icon: <Printer className="h-4 w-4" />, onClick: () => navigate(`/sales/invoices/${i.id}?print=1`) },
        ]}
      />
      <GenerateDialog open={generating} onClose={() => setGenerating(false)} />
    </>
  );
}

function GenerateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const pending = useData(() => services.sales.invoices.uninvoicedDispatches());
  const [dispatchId, setDispatchId] = useState('');
  const [date, setDate] = useState(today());
  const [touched, setTouched] = useState(false);
  const chosen = pending.data?.find((d) => d.id === dispatchId);

  const submit = async () => {
    setTouched(true);
    if (!chosen || !date || date > today()) return;
    const inv = await run(() => services.sales.invoices.createFromDispatch(chosen.id, date), 'Invoice generated');
    if (inv) {
      onClose();
      navigate(`/sales/invoices/${inv.id}`);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={busy}
      title="Generate invoice"
      description="Invoices are created from dispatches that have not been invoiced yet."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!pending.data?.length}>Generate invoice</Button>
        </>
      }
    >
      {pending.data && pending.data.length === 0 ? (
        <p className="text-sm text-neutral-600">Every dispatch has already been invoiced. Record a new dispatch first.</p>
      ) : (
        <div className="space-y-3.5">
          <Field label="Dispatch" required error={touched && !chosen ? 'Select a dispatch' : undefined}>
            <Select value={dispatchId} onChange={(e) => setDispatchId(e.target.value)} placeholder="Select dispatch…" options={(pending.data ?? []).map((d) => ({ value: d.id, label: `${d.dispatchNo} — ${d.distributorName} (${formatDate(d.date)})` }))} />
          </Field>
          <Field label="Invoice date" required error={date > today() ? 'Invoice date cannot be in the future' : touched && !date ? 'Required' : undefined} hint={chosen ? `Cannot be before the dispatch date (${formatDate(chosen.date)}).` : undefined}>
            <Input type="date" value={date} min={chosen?.date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
