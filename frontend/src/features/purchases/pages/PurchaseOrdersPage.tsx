import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Can } from '@/app/AuthContext';
import { DataTable, type Column } from '@/components/data/DataTable';
import { LinkButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { FilterSelect } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { PurchaseOrderRow } from '@/types';
import { formatCurrency, formatDate, formatPercent } from '@/utils/format';
import { usePOActions } from '../components/poActions';

const STATUSES = ['draft', 'ordered', 'partial', 'received', 'cancelled'].map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }));

export default function PurchaseOrdersPage() {
  const orders = useData(() => services.purchases.orders.list());
  const lk = useLookups();
  const navigate = useNavigate();
  const actions = usePOActions();
  const [status, setStatus] = useState('');
  const [supplier, setSupplier] = useState('');

  const rows = useMemo(() => orders.data?.filter((o) => (!status || o.status === status) && (!supplier || o.supplierId === supplier)), [orders.data, status, supplier]);

  const columns: Column<PurchaseOrderRow>[] = [
    { key: 'poNo', header: 'PO no', value: (r) => r.poNo, cell: (r) => <Link to={`/purchases/orders/${r.id}`} className="font-medium text-neutral-900 hover:underline">{r.poNo}</Link>, primary: true },
    { key: 'supplier', header: 'Supplier', value: (r) => r.supplierName },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date), csv: (r) => r.date },
    { key: 'expected', header: 'Expected', value: (r) => r.expectedDate, cell: (r) => formatDate(r.expectedDate), csv: (r) => r.expectedDate },
    { key: 'total', header: 'Total', align: 'right', value: (r) => r.total, cell: (r) => formatCurrency(r.total) },
    { key: 'status', header: 'Status', value: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'received', header: 'Received', align: 'right', value: (r) => r.receivedPct, cell: (r) => formatPercent(r.receivedPct, 0) },
  ];

  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="Orders placed with suppliers."
        actions={
          <Can module="purchases">
            <LinkButton to="/purchases/orders/new" icon={<Plus className="h-4 w-4" />}>
              New purchase order
            </LinkButton>
          </Can>
        }
      />
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={orders.loading}
        error={orders.error}
        onRetry={orders.reload}
        searchText={(r) => `${r.poNo} ${r.supplierName}`}
        searchPlaceholder="Search PO or supplier…"
        exportName="purchase-orders"
        defaultSort={{ key: 'date', dir: 'desc' }}
        onRowClick={(r) => navigate(`/purchases/orders/${r.id}`)}
        rowActions={actions}
        emptyTitle="No purchase orders yet"
        emptyDescription="Create a purchase order to order stock from a supplier."
        filters={
          <>
            <FilterSelect value={status} onChange={setStatus} options={STATUSES} allLabel="All statuses" />
            <FilterSelect value={supplier} onChange={setSupplier} options={lk.suppliers.map((s) => ({ value: s.id, label: s.name }))} allLabel="All suppliers" />
          </>
        }
      />
    </>
  );
}
