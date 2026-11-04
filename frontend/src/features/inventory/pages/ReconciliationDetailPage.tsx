import { CheckCircle2, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { DataTable, type Column } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, DescriptionList } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Confirm';
import { PageHeader } from '@/components/ui/PageHeader';
import { Loadable } from '@/components/ui/States';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { ReconciliationLine } from '@/types';
import { cn } from '@/utils/cn';
import { formatDate, formatNumber } from '@/utils/format';

export default function ReconciliationDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const canEdit = useAuth().can('inventory', 'edit');
  const confirm = useConfirm();
  const { run, busy } = useAction();
  const rec = useData(() => services.inventory.getReconciliation(id), [id]);
  const batches = useData(() => services.inventory.batchStock());
  const info = (batchId: string) => batches.data?.find((b) => b.id === batchId);

  const approve = async () => {
    const ok = await confirm({ title: 'Approve stock count?', message: 'Stock adjustments will be posted for every difference between the current system stock and the physical count. The change is recorded in the audit trail and cannot be undone.', confirmLabel: 'Approve & adjust stock' });
    if (ok) await run(() => services.inventory.approveReconciliation(id), 'Reconciliation approved and stock adjusted');
  };
  const remove = async () => {
    const ok = await confirm({ title: 'Delete this draft?', message: 'The count will be discarded. No stock is changed.', confirmLabel: 'Delete', danger: true });
    if (ok && (await run(() => services.inventory.deleteReconciliation(id), 'Draft deleted')) !== undefined) navigate('/inventory/reconciliation', { replace: true });
  };

  return (
    <Loadable state={rec}>
      {(r) => {
        const draft = r.status === 'draft';
        const diff = (l: ReconciliationLine) => (draft ? l.physicalQty - l.systemQty : (l.appliedDiff ?? 0));
        const columns: Column<ReconciliationLine>[] = [
          { key: 'product', header: 'Product', primary: true, value: (l) => info(l.batchId)?.productName ?? l.productId, cell: (l) => <span className="font-medium text-neutral-900">{info(l.batchId)?.productName ?? l.productId}</span> },
          { key: 'batch', header: 'Batch', value: (l) => info(l.batchId)?.batchNo ?? l.batchId },
          { key: 'system', header: draft ? 'System qty (at count)' : 'System qty', align: 'right', value: (l) => l.systemQty, cell: (l) => formatNumber(l.systemQty) },
          { key: 'physical', header: 'Physical count', align: 'right', value: (l) => l.physicalQty, cell: (l) => formatNumber(l.physicalQty) },
          {
            key: 'var',
            header: draft ? 'Variance' : 'Adjustment posted',
            align: 'right',
            value: diff,
            cell: (l) => <span className={cn('font-medium', diff(l) < 0 && 'text-red-600', diff(l) > 0 && 'text-emerald-700')}>{diff(l) > 0 ? '+' : ''}{diff(l)}</span>,
          },
        ];
        return (
          <>
            <PageHeader
              title={r.refNo}
              meta={<StatusBadge status={r.status} />}
              breadcrumbs={[{ label: 'Inventory' }, { label: 'Reconciliation', to: '/inventory/reconciliation' }, { label: r.refNo }]}
              actions={
                draft &&
                canEdit && (
                  <>
                    <Button variant="secondary" icon={<Trash2 className="h-4 w-4" />} onClick={remove} disabled={busy}>Delete draft</Button>
                    <Button icon={<CheckCircle2 className="h-4 w-4" />} onClick={approve} loading={busy}>Approve & adjust stock</Button>
                  </>
                )
              }
            />
            <Card className="mb-4">
              <CardBody>
                <DescriptionList
                  items={[
                    { label: 'Count date', value: formatDate(r.date) },
                    { label: 'Batches counted', value: r.lines.length },
                    { label: 'Net variance', value: `${r.lines.reduce((s, l) => s + diff(l), 0)} units` },
                    { label: 'Approved by', value: r.approvedBy ? `${r.approvedBy} on ${formatDate(r.approvedOn)}` : 'Not yet approved' },
                    { label: 'Notes', value: r.notes || '—' },
                  ]}
                />
              </CardBody>
            </Card>
            {draft && <p className="mb-3 text-xs text-neutral-500">Variance is shown against the system quantity recorded when the count was entered. On approval, the adjustment is calculated against the current stock.</p>}
            <DataTable data={r.lines} columns={columns} rowKey={(l) => l.batchId} loading={batches.loading} exportName={r.refNo} pageSize={25} />
          </>
        );
      }}
    </Loadable>
  );
}
