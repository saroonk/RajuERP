import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/States';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { PaymentRow } from '@/types';
import { formatCurrency, formatDate, round2 } from '@/utils/format';

/** Allocates the unallocated part of an existing payment to the distributor's open invoices. */
export function AllocationModal({ payment, onClose }: { payment: PaymentRow | null; onClose: () => void }) {
  return (
    <Modal open={!!payment} onClose={onClose} title="Allocate payment to invoices" description={payment ? `${payment.receiptNo} · ${payment.distributorName}` : undefined} size="lg">
      {payment && <AllocationBody payment={payment} onClose={onClose} />}
    </Modal>
  );
}

function AllocationBody({ payment, onClose }: { payment: PaymentRow; onClose: () => void }) {
  const open = useData(() => services.accounts.openInvoices(payment.distributorId), [payment.distributorId]);
  const { run, busy } = useAction();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const num = (id: string) => {
    const v = parseFloat(amounts[id] ?? '');
    return Number.isFinite(v) ? v : 0;
  };
  const invoices = open.data ?? [];
  const total = round2(invoices.reduce((s, i) => s + num(i.id), 0));
  const remaining = round2(payment.unallocated - total);

  const autoFill = async () => {
    const s = await services.accounts.suggestAllocations(payment.distributorId, payment.unallocated);
    setAmounts(Object.fromEntries(s.filter((x) => x.suggested > 0).map((x) => [x.invoiceId, String(x.suggested)])));
    setError('');
  };

  useEffect(() => {
    void autoFill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment.id]);

  const submit = async () => {
    const rows = invoices.filter((i) => num(i.id) > 0);
    if (rows.length === 0) return setError('Enter an amount against at least one invoice');
    const over = rows.find((i) => num(i.id) > i.outstanding + 0.005);
    if (over) return setError(`Amount for ${over.invoiceNo} exceeds its outstanding ${formatCurrency(over.outstanding)}`);
    if (total > payment.unallocated + 0.005) return setError(`Allocated total exceeds the unallocated amount ${formatCurrency(payment.unallocated)}`);
    setError('');
    const res = await run(() => services.accounts.payments.allocate(payment.id, rows.map((i) => ({ invoiceId: i.id, amount: num(i.id) }))), 'Payment allocated');
    if (res) onClose();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-xs text-neutral-500">Unallocated</p>
          <p className="tabular font-semibold">{formatCurrency(payment.unallocated)}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-500">Allocating now</p>
          <p className="tabular font-semibold">{formatCurrency(total)}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-500">Remains on account</p>
          <p className={`tabular font-semibold ${remaining < 0 ? 'text-red-600' : ''}`}>{formatCurrency(remaining)}</p>
        </div>
      </div>
      {open.loading ? (
        <Spinner />
      ) : invoices.length === 0 ? (
        <p className="rounded-xl bg-slate-50/80 ring-1 ring-slate-900/[0.04] p-4 text-sm text-neutral-600">This distributor has no open invoices to allocate against.</p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl ring-1 ring-slate-900/[0.07]">
          {invoices.map((i) => (
            <li key={i.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm">
                <p className="font-medium">{i.invoiceNo}</p>
                <p className="text-xs text-neutral-500">
                  {formatDate(i.date)} · due {formatDate(i.dueDate)}
                  {i.overdue && <span className="ml-1 text-red-600">({i.daysOverdue}d overdue)</span>} · outstanding {formatCurrency(i.outstanding)}
                </p>
              </div>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                aria-label={`Amount for ${i.invoiceNo}`}
                value={amounts[i.id] ?? ''}
                onChange={(e) => setAmounts((a) => ({ ...a, [i.id]: e.target.value }))}
                placeholder="0.00"
                className="sm:w-36"
              />
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={autoFill} disabled={busy || invoices.length === 0}>
          Auto-allocate (oldest first)
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={submit} loading={busy} disabled={invoices.length === 0}>
          Allocate
        </Button>
      </div>
    </div>
  );
}
