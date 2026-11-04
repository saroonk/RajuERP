import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Confirm';
import { Field, Input, Select } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { Loadable } from '@/components/ui/States';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { SalesReturnRow } from '@/types';
import { formatCurrency, formatDate, formatNumber, titleCase } from '@/utils/format';

type Decision = 'saleable' | 'damaged' | 'expired';
const EFFECT: Record<string, string> = {
  saleable: 'Returned to sellable stock.',
  damaged: 'Held as damaged stock — not sellable.',
  expired: 'Held as expired stock — available to write off.',
  inspection: 'On hold awaiting inspection — not sellable.',
};

export default function SalesReturnDetailPage() {
  const { id = '' } = useParams();
  const state = useData(() => services.sales.returns.get(id), [id]);
  return <Loadable state={state}>{(r) => <Detail ret={r} />}</Loadable>;
}

function Detail({ ret }: { ret: SalesReturnRow }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const { run, busy } = useAction();
  const lookups = useLookups();
  const batches = useData(() => services.inventory.batchStock());
  const [deciding, setDeciding] = useState<number | null>(null);
  const [decision, setDecision] = useState<Decision>('saleable');
  const [note, setNote] = useState('');
  const canEdit = can('sales', 'edit') || can('inventory', 'edit');

  const apply = async () => {
    if (deciding === null) return;
    const line = ret.lines[deciding];
    const ok = await confirm({
      title: 'Confirm disposition?',
      message: `${formatNumber(line.qty)} × ${lookups.productName(line.productId)} will be moved from inspection to ${decision} stock. ${EFFECT[decision]} This cannot be changed afterwards.`,
      confirmLabel: 'Confirm',
      danger: decision !== 'saleable',
    });
    if (!ok) return;
    const saved = await run(() => services.sales.returns.reclassify(ret.id, deciding, decision, note), 'Disposition recorded');
    if (saved) {
      setDeciding(null);
      setNote('');
    }
  };

  return (
    <>
      <PageHeader title={ret.returnNo} meta={<StatusBadge status={ret.status} />} breadcrumbs={[{ label: 'Sales returns', to: '/sales/returns' }, { label: ret.returnNo }]} />
      <div className="space-y-4">
        <Card>
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Distributor', value: ret.distributorName },
                { label: 'Invoice', value: <Link className="hover:underline" to={`/sales/invoices/${ret.invoiceId}`}>{ret.invoiceNo}</Link> },
                { label: 'Return date', value: formatDate(ret.date) },
                { label: 'Reason', value: titleCase(ret.reason) },
                { label: 'Value (taxable)', value: formatCurrency(ret.value) },
                { label: 'Credit note', value: ret.creditNoteNo ? <Link className="hover:underline" to="/sales/notes">{ret.creditNoteNo}</Link> : 'Not issued' },
                { label: 'Notes', value: ret.notes || '—' },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Returned lines" description="Each line's classification decides which stock bucket it sits in." />
          <div className="divide-y divide-neutral-100">
            {ret.lines.map((l, i) => (
              <div key={`${l.productId}-${l.batchId}-${i}`} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{lookups.productName(l.productId)}</p>
                  <p className="text-xs text-neutral-500">Batch {batches.data?.find((b) => b.id === l.batchId)?.batchNo ?? '—'} · {formatNumber(l.qty)} units · {formatCurrency(l.rate)} each</p>
                  <p className="mt-1 text-xs text-neutral-600">{EFFECT[l.classification]} {l.dispositionNote && l.classification !== 'inspection' && `— ${l.dispositionNote}`}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={l.classification} label={l.classification === 'inspection' ? 'Needs inspection' : undefined} />
                  {l.classification === 'inspection' && canEdit && (
                    <Button size="sm" variant="secondary" icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => { setDeciding(i); setDecision('saleable'); setNote(''); }}>Decide disposition</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Modal
        open={deciding !== null}
        onClose={() => setDeciding(null)}
        locked={busy}
        title="Decide disposition"
        description={deciding !== null ? `${lookups.productName(ret.lines[deciding].productId)} · ${formatNumber(ret.lines[deciding].qty)} units` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeciding(null)} disabled={busy}>Cancel</Button>
            <Button onClick={apply} loading={busy}>Apply decision</Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <Field label="Outcome of inspection" required hint={EFFECT[decision]}>
            <Select value={decision} onChange={(e) => setDecision(e.target.value as Decision)} options={[{ value: 'saleable', label: 'Saleable' }, { value: 'damaged', label: 'Damaged' }, { value: 'expired', label: 'Expired' }]} />
          </Field>
          <Field label="Inspection note">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Packaging intact, seal verified" />
          </Field>
        </div>
      </Modal>
    </>
  );
}
