import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardCheck, Eye, Plus } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { DataTable, type Column } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { LinkButton } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { SalesReturnRow } from '@/types';
import { formatCurrency, formatDate, formatNumber, titleCase } from '@/utils/format';

export default function SalesReturnsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const list = useData(() => services.sales.returns.list());
  const [tab, setTab] = useState('all');
  const canEdit = can('sales', 'edit');

  const filters: Record<string, (r: SalesReturnRow) => boolean> = {
    all: () => true,
    pending: (r) => r.status === 'pending_inspection',
    expiry: (r) => r.reason === 'expired' || r.reason === 'near_expiry',
  };
  const rows = useMemo(() => list.data?.filter(filters[tab]), [list.data, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (k: string) => list.data?.filter(filters[k]).length ?? 0;

  const columns: Column<SalesReturnRow>[] = [
    { key: 'no', header: 'Return no', primary: true, value: (r) => r.returnNo, cell: (r) => <Link to={`/sales/returns/${r.id}`} className="font-medium hover:underline">{r.returnNo}</Link> },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date) },
    { key: 'dist', header: 'Distributor', value: (r) => r.distributorName },
    { key: 'inv', header: 'Invoice', value: (r) => r.invoiceNo, cell: (r) => <Link to={`/sales/invoices/${r.invoiceId}`} className="hover:underline">{r.invoiceNo}</Link> },
    { key: 'reason', header: 'Reason', value: (r) => titleCase(r.reason) },
    { key: 'qty', header: 'Qty', align: 'right', value: (r) => r.totalQty, cell: (r) => formatNumber(r.totalQty) },
    { key: 'value', header: 'Value (taxable)', align: 'right', value: (r) => r.value, cell: (r) => formatCurrency(r.value) },
    { key: 'status', header: 'Status', value: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'cn', header: 'Credit note', value: (r) => r.creditNoteNo ?? '', cell: (r) => r.creditNoteNo ?? <span className="text-neutral-400">None</span> },
  ];

  return (
    <>
      <PageHeader
        title="Sales returns"
        description="Goods returned by distributors, classified as saleable, damaged, expired or pending inspection."
        actions={canEdit && <LinkButton to="/sales/returns/new" icon={<Plus className="h-4 w-4" />}>Record return</LinkButton>}
      />
      <Tabs className="mb-3" value={tab} onChange={setTab} tabs={[{ key: 'all', label: 'All returns', count: count('all') }, { key: 'pending', label: 'Pending inspection', count: count('pending') }, { key: 'expiry', label: 'Expiry returns', count: count('expiry') }]} />
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        searchText={(r) => `${r.returnNo} ${r.distributorName} ${r.invoiceNo}`}
        exportName="sales-returns"
        defaultSort={{ key: 'date', dir: 'desc' }}
        emptyTitle={tab === 'all' ? 'No returns recorded' : 'Nothing here'}
        emptyDescription={tab === 'pending' ? 'No returned stock is waiting for inspection.' : undefined}
        onRowClick={(r) => navigate(`/sales/returns/${r.id}`)}
        rowActions={(r) => [
          { label: 'View', icon: <Eye className="h-4 w-4" />, onClick: () => navigate(`/sales/returns/${r.id}`) },
          { label: 'Decide disposition', icon: <ClipboardCheck className="h-4 w-4" />, onClick: () => navigate(`/sales/returns/${r.id}`), hidden: r.status !== 'pending_inspection' || !canEdit },
        ]}
      />
    </>
  );
}
