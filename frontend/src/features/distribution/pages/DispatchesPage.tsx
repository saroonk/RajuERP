import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, FileText, Plus } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { DataTable, type Column } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { LinkButton } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/Confirm';
import { FilterSelect } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { DispatchRow } from '@/types';
import { formatDate, formatNumber, today } from '@/utils/format';

export default function DispatchesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { run } = useAction();
  const lookups = useLookups();
  const list = useData(() => services.distribution.dispatches.list());
  const [distributor, setDistributor] = useState('');
  const [invoiced, setInvoiced] = useState('');
  const canEdit = can('distribution', 'edit');
  const canInvoice = can('sales', 'edit');

  const rows = useMemo(
    () => list.data?.filter((d) => (!distributor || d.distributorId === distributor) && (!invoiced || (invoiced === 'yes' ? !!d.invoiceId : !d.invoiceId))),
    [list.data, distributor, invoiced],
  );

  const generate = async (d: DispatchRow) => {
    if (!(await confirm({ title: 'Generate invoice?', message: `An invoice dated today will be created for dispatch ${d.dispatchNo} using the order rates.`, confirmLabel: 'Generate invoice' }))) return;
    const inv = await run(() => services.sales.invoices.createFromDispatch(d.id, today()), 'Invoice generated');
    if (inv) navigate(`/sales/invoices/${inv.id}`);
  };

  const columns: Column<DispatchRow>[] = [
    { key: 'no', header: 'Dispatch no', primary: true, value: (r) => r.dispatchNo, cell: (r) => <Link to={`/distribution/dispatches/${r.id}`} className="font-medium hover:underline">{r.dispatchNo}</Link> },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date) },
    { key: 'order', header: 'Order', value: (r) => r.orderNo, cell: (r) => <Link to={`/distribution/orders/${r.orderId}`} className="hover:underline">{r.orderNo}</Link> },
    { key: 'dist', header: 'Distributor', value: (r) => r.distributorName },
    { key: 'qty', header: 'Total qty', align: 'right', value: (r) => r.totalQty, cell: (r) => formatNumber(r.totalQty) },
    { key: 'vehicle', header: 'Vehicle', value: (r) => r.vehicleNo, hideOnMobile: true },
    { key: 'ref', header: 'Delivery ref', value: (r) => r.deliveryRef, hideOnMobile: true },
    { key: 'inv', header: 'Invoice', value: (r) => r.invoiceNo ?? '', cell: (r) => (r.invoiceId ? <Link to={`/sales/invoices/${r.invoiceId}`} className="hover:underline">{r.invoiceNo}</Link> : <StatusBadge status="unpaid" label="Not invoiced" />) },
  ];

  return (
    <>
      <PageHeader
        title="Dispatches"
        description="Goods sent to distributors, with batch allocation. Dispatch is not the same as distributor sales."
        actions={canEdit && <LinkButton to="/distribution/dispatches/new" icon={<Plus className="h-4 w-4" />}>New dispatch</LinkButton>}
      />
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        searchText={(r) => `${r.dispatchNo} ${r.orderNo} ${r.distributorName} ${r.vehicleNo} ${r.deliveryRef}`}
        exportName="dispatches"
        emptyTitle="No dispatches yet"
        emptyDescription="Dispatch a confirmed order to allocate batches and reduce stock."
        onRowClick={(r) => navigate(`/distribution/dispatches/${r.id}`)}
        filters={
          <>
            <FilterSelect value={distributor} onChange={setDistributor} options={lookups.distributors.map((d) => ({ value: d.id, label: d.name }))} allLabel="All distributors" />
            <FilterSelect value={invoiced} onChange={setInvoiced} options={[{ value: 'yes', label: 'Invoiced' }, { value: 'no', label: 'Not invoiced' }]} allLabel="Any invoice status" />
          </>
        }
        rowActions={(d) => [
          { label: 'View', icon: <Eye className="h-4 w-4" />, onClick: () => navigate(`/distribution/dispatches/${d.id}`) },
          { label: 'Generate invoice', icon: <FileText className="h-4 w-4" />, onClick: () => generate(d), hidden: !!d.invoiceId || !canInvoice },
        ]}
      />
    </>
  );
}
