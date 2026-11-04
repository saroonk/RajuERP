import { CheckCircle2, Eye, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { DataTable, type Column } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { LinkButton } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/Confirm';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/utils/cn';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { Reconciliation } from '@/types';
import { formatDate } from '@/utils/format';

type Row = Reconciliation & { totalVariance: number };

export default function ReconciliationListPage() {
  const navigate = useNavigate();
  const canEdit = useAuth().can('inventory', 'edit');
  const confirm = useConfirm();
  const { run } = useAction();
  const list = useData(() => services.inventory.reconciliations());

  const approve = async (r: Row) => {
    const ok = await confirm({ title: `Approve ${r.refNo}?`, message: 'Stock adjustments will be posted for every counted difference. This is recorded in the audit trail and cannot be undone.', confirmLabel: 'Approve & adjust stock' });
    if (ok) await run(() => services.inventory.approveReconciliation(r.id), `${r.refNo} approved`);
  };
  const remove = async (r: Row) => {
    const ok = await confirm({ title: `Delete ${r.refNo}?`, message: 'This draft count will be discarded. No stock is changed.', confirmLabel: 'Delete', danger: true });
    if (ok) await run(() => services.inventory.deleteReconciliation(r.id), 'Draft deleted');
  };

  const columns: Column<Row>[] = [
    { key: 'ref', header: 'Reference', value: (r) => r.refNo, primary: true, cell: (r) => <span className="font-medium text-neutral-900">{r.refNo}</span> },
    { key: 'date', header: 'Count date', value: (r) => r.date, cell: (r) => formatDate(r.date) },
    { key: 'status', header: 'Status', value: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'batches', header: 'Batches counted', align: 'right', value: (r) => r.lines.length },
    {
      key: 'variance',
      header: 'Net variance',
      align: 'right',
      value: (r) => r.totalVariance,
      cell: (r) => <span className={cn(r.totalVariance < 0 && 'text-red-600', r.totalVariance > 0 && 'text-emerald-700')}>{r.totalVariance > 0 ? '+' : ''}{r.totalVariance}</span>,
    },
    { key: 'approved', header: 'Approved by', value: (r) => (r.approvedBy ? `${r.approvedBy} · ${formatDate(r.approvedOn)}` : ''), hideOnMobile: true },
    { key: 'notes', header: 'Notes', value: (r) => r.notes, hideOnMobile: true },
  ];

  return (
    <>
      <PageHeader
        title="Stock reconciliation"
        description="Compare system stock with physical counts and post authorised adjustments."
        breadcrumbs={[{ label: 'Inventory' }, { label: 'Reconciliation' }]}
        actions={canEdit && <LinkButton to="/inventory/reconciliation/new" icon={<Plus className="h-4 w-4" />}>New stock count</LinkButton>}
      />
      <DataTable
        data={list.data}
        columns={columns}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        searchText={(r) => `${r.refNo} ${r.notes}`}
        exportName="stock-reconciliations"
        defaultSort={{ key: 'date', dir: 'desc' }}
        emptyTitle="No stock counts yet"
        emptyDescription="Start a stock count to compare physical stock against the system."
        emptyAction={canEdit ? <LinkButton to="/inventory/reconciliation/new" icon={<Plus className="h-4 w-4" />}>New stock count</LinkButton> : undefined}
        onRowClick={(r) => navigate(`/inventory/reconciliation/${r.id}`)}
        rowActions={(r) => [
          { label: 'View', icon: <Eye className="h-4 w-4" />, onClick: () => navigate(`/inventory/reconciliation/${r.id}`) },
          { label: 'Approve', icon: <CheckCircle2 className="h-4 w-4" />, onClick: () => approve(r), hidden: r.status !== 'draft' || !canEdit },
          { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onClick: () => remove(r), danger: true, hidden: r.status !== 'draft' || !canEdit },
        ]}
      />
    </>
  );
}
