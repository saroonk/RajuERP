import { useConfirm } from '@/components/ui/Confirm';
import { useAction } from '@/hooks/useAction';
import { services } from '@/services';
import type { DistributionOrderRow } from '@/types';

/** Confirm / cancel / delete for an order, with confirmation dialogs and toasts. */
export function useOrderActions() {
  const confirm = useConfirm();
  const { run } = useAction();
  return {
    confirmOrder: async (o: DistributionOrderRow) => {
      if (await confirm({ title: 'Confirm order?', message: `Order ${o.orderNo} will be confirmed and can then be dispatched.`, confirmLabel: 'Confirm order' })) {
        await run(() => services.distribution.orders.confirm(o.id), 'Order confirmed');
      }
    },
    cancelOrder: async (o: DistributionOrderRow) => {
      if (await confirm({ title: 'Cancel order?', message: `Order ${o.orderNo} will be cancelled.`, confirmLabel: 'Cancel order', danger: true })) {
        await run(() => services.distribution.orders.cancel(o.id), 'Order cancelled');
      }
    },
    deleteOrder: async (o: DistributionOrderRow): Promise<boolean> => {
      if (!(await confirm({ title: 'Delete order?', message: `Order ${o.orderNo} will be permanently deleted.`, confirmLabel: 'Delete', danger: true }))) return false;
      return (await run(() => services.distribution.orders.remove(o.id).then(() => true), 'Order deleted')) ?? false;
    },
  };
}
