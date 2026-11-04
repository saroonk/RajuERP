import { useNavigate } from 'react-router-dom';
import { Ban, CheckCircle2, Eye, PackageCheck, Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { useConfirm } from '@/components/ui/Confirm';
import type { MenuItem } from '@/components/ui/Menu';
import { useAction } from '@/hooks/useAction';
import { services } from '@/services';
import type { PurchaseOrderRow } from '@/types';

/** Action menu for a purchase order, shared by the list and the detail page. */
export function usePOActions(opts: { includeView?: boolean; onDeleted?: () => void } = {}) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const { run } = useAction();
  const navigate = useNavigate();
  const canEdit = can('purchases', 'edit');

  return (po: PurchaseOrderRow): MenuItem[] => {
    const hasReceipts = po.lineProgress.some((l) => l.received > 0);
    return [
      { label: 'View', icon: <Eye className="h-4 w-4" />, onClick: () => navigate(`/purchases/orders/${po.id}`), hidden: opts.includeView === false },
      { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onClick: () => navigate(`/purchases/orders/${po.id}/edit`), hidden: !canEdit || !(po.status === 'draft' || po.status === 'ordered') || hasReceipts },
      {
        label: 'Mark as ordered',
        icon: <CheckCircle2 className="h-4 w-4" />,
        onClick: () => void run(() => services.purchases.orders.setStatus(po.id, 'ordered'), `${po.poNo} marked as ordered`),
        hidden: !canEdit || po.status !== 'draft',
      },
      { label: 'Receive goods', icon: <PackageCheck className="h-4 w-4" />, onClick: () => navigate(`/purchases/receipts/new?po=${po.id}`), hidden: !can('purchases', 'edit') || !(po.status === 'ordered' || po.status === 'partial') },
      {
        label: 'Cancel order',
        icon: <Ban className="h-4 w-4" />,
        hidden: !canEdit || !(po.status === 'draft' || po.status === 'ordered') || hasReceipts,
        onClick: async () => {
          if (await confirm({ title: 'Cancel purchase order?', message: `${po.poNo} will be marked as cancelled.`, confirmLabel: 'Cancel order', danger: true })) {
            await run(() => services.purchases.orders.setStatus(po.id, 'cancelled'), `${po.poNo} cancelled`);
          }
        },
      },
      {
        label: 'Delete',
        icon: <Trash2 className="h-4 w-4" />,
        danger: true,
        hidden: !canEdit || !(po.status === 'draft' || po.status === 'cancelled'),
        onClick: async () => {
          if (await confirm({ title: 'Delete purchase order?', message: `${po.poNo} will be permanently removed.`, confirmLabel: 'Delete', danger: true })) {
            const ok = await run(() => services.purchases.orders.remove(po.id).then(() => true), `${po.poNo} deleted`);
            if (ok) opts.onDeleted?.();
          }
        },
      },
    ];
  };
}
