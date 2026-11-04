import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Eye, Pencil, Plus, Trash2, Truck, XCircle } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { DataTable, type Column } from '@/components/data/DataTable';
import { LinkButton } from '@/components/ui/Button';
import { FilterSelect } from '@/components/ui/Inputs';
import { StatusBadge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import { useOrderActions } from '../components/useOrderActions';
import type { DistributionOrderRow } from '@/types';
import { formatCurrency, formatDate, formatPercent } from '@/utils/format';

const STATUSES = ['draft', 'confirmed', 'partially_dispatched', 'dispatched', 'cancelled'].map((s) => ({ value: s, label: s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) }));

export default function OrdersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const lookups = useLookups();
  const list = useData(() => services.distribution.orders.list());
  const [status, setStatus] = useState('');
  const [distributor, setDistributor] = useState('');
  const actions = useOrderActions();
  const canEdit = can('distribution', 'edit');

  const rows = useMemo(() => list.data?.filter((o) => (!status || o.status === status) && (!distributor || o.distributorId === distributor)), [list.data, status, distributor]);

  const columns: Column<DistributionOrderRow>[] = [
    { key: 'orderNo', header: 'Order no', value: (r) => r.orderNo, primary: true, cell: (r) => <Link to={`/distribution/orders/${r.id}`} className="font-medium text-neutral-900 hover:underline">{r.orderNo}</Link> },
    { key: 'distributor', header: 'Distributor', value: (r) => r.distributorName },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date) },
    { key: 'expected', header: 'Expected', value: (r) => r.expectedDate, cell: (r) => formatDate(r.expectedDate), hideOnMobile: true },
    { key: 'total', header: 'Total', align: 'right', value: (r) => r.total, cell: (r) => formatCurrency(r.total) },
    { key: 'status', header: 'Status', value: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'pct', header: 'Dispatched', align: 'right', value: (r) => r.dispatchedPct, cell: (r) => formatPercent(r.dispatchedPct, 0) },
  ];

  return (
    <>
      <PageHeader
        title="Distribution orders"
        description="Orders received from distributors and dealers."
        actions={canEdit && <LinkButton to="/distribution/orders/new" icon={<Plus className="h-4 w-4" />}>New order</LinkButton>}
      />
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        searchText={(r) => `${r.orderNo} ${r.distributorName}`}
        searchPlaceholder="Search orders…"
        exportName="distribution-orders"
        emptyTitle="No orders yet"
        emptyDescription="Create an order to start distributing stock."
        onRowClick={(r) => navigate(`/distribution/orders/${r.id}`)}
        filters={
          <>
            <FilterSelect value={status} onChange={setStatus} options={STATUSES} allLabel="All statuses" />
            <FilterSelect value={distributor} onChange={setDistributor} options={lookups.distributors.map((d) => ({ value: d.id, label: d.name }))} allLabel="All distributors" />
          </>
        }
        rowActions={(o) => [
          { label: 'View', icon: <Eye className="h-4 w-4" />, onClick: () => navigate(`/distribution/orders/${o.id}`) },
          { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onClick: () => navigate(`/distribution/orders/${o.id}/edit`), hidden: !canEdit || o.hasDispatches || !['draft', 'confirmed'].includes(o.status) },
          { label: 'Confirm', icon: <CheckCircle2 className="h-4 w-4" />, onClick: () => actions.confirmOrder(o), hidden: !canEdit || o.status !== 'draft' },
          { label: 'Dispatch', icon: <Truck className="h-4 w-4" />, onClick: () => navigate(`/distribution/dispatches/new?order=${o.id}`), hidden: !canEdit || !['confirmed', 'partially_dispatched'].includes(o.status) },
          { label: 'Cancel order', icon: <XCircle className="h-4 w-4" />, onClick: () => actions.cancelOrder(o), hidden: !canEdit || !['draft', 'confirmed'].includes(o.status) || o.hasDispatches, danger: true },
          { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onClick: () => void actions.deleteOrder(o), hidden: !canEdit || !['draft', 'cancelled'].includes(o.status), danger: true },
        ]}
      />
    </>
  );
}
