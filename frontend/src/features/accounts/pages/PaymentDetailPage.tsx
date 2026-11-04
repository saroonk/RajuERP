import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BookOpen, Printer, Split } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { Loadable } from '@/components/ui/States';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import { formatCurrency, formatDate, titleCase } from '@/utils/format';
import { AllocationModal } from '../components/AllocationModal';
import { rupeesInWords } from '../utils/numberToWords';

export default function PaymentDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const payment = useData(() => services.accounts.payments.get(id), [id]);
  const settings = useData(() => services.admin.settings());
  const invoices = useData(() => services.sales.invoices.list());
  const distributors = useData(() => services.distributors.list());
  const [allocating, setAllocating] = useState(false);

  return (
    <Loadable state={payment}>
      {(p) => {
        const dist = distributors.data?.find((d) => d.id === p.distributorId);
        const s = settings.data;
        return (
          <>
            <PageHeader
              title={`Receipt ${p.receiptNo}`}
              breadcrumbs={[{ label: 'Accounts' }, { label: 'Payments received', to: '/accounts/payments' }, { label: p.receiptNo }]}
              meta={p.unallocated > 0.005 ? <Badge tone="warning">Part on account</Badge> : <Badge tone="success">Fully allocated</Badge>}
              actions={
                <>
                  <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
                    Print / Save as PDF
                  </Button>
                  {p.unallocated > 0.005 && can('receivables', 'edit') && (
                    <Button variant="secondary" icon={<Split className="h-4 w-4" />} onClick={() => setAllocating(true)}>
                      Allocate remaining
                    </Button>
                  )}
                  <Link to={`/accounts/ledger/${p.distributorId}`} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-white shadow-sm ring-1 ring-slate-900/10 px-4 text-sm font-medium hover:bg-neutral-50 md:h-9">
                    <BookOpen className="h-4 w-4" /> Ledger
                  </Link>
                </>
              }
            />
            <article className="print-area surface mx-auto max-w-3xl p-5 sm:p-8">
              <header className="flex flex-col gap-3 border-b border-neutral-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{s?.companyName ?? 'RajuERP'}</h2>
                  <p className="text-xs text-neutral-600">{s?.address}</p>
                  <p className="text-xs text-neutral-600">GSTIN: {s?.gstin} · {s?.phone}</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-sm font-semibold uppercase tracking-wide">Payment receipt</p>
                  <p className="text-sm">{p.receiptNo}</p>
                  <p className="text-xs text-neutral-600">Date: {formatDate(p.date)}</p>
                </div>
              </header>

              <section className="grid gap-4 py-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-neutral-500">Received from</p>
                  <p className="font-medium">{p.distributorName}</p>
                  {dist && (
                    <>
                      <p className="text-xs text-neutral-600">{dist.address}, {dist.city}, {dist.state}</p>
                      <p className="text-xs text-neutral-600">GSTIN: {dist.gstin || '—'}</p>
                    </>
                  )}
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-neutral-500">Payment</p>
                  <p>{titleCase(p.mode)}</p>
                  {p.reference && <p className="text-xs text-neutral-600">Ref: {p.reference}</p>}
                  {p.notes && <p className="text-xs text-neutral-600">{p.notes}</p>}
                </div>
              </section>

              <section className="rounded-xl bg-slate-50/80 ring-1 ring-slate-900/[0.04] p-4">
                <p className="text-xs text-neutral-500">Amount received</p>
                <p className="tabular text-2xl font-semibold">{formatCurrency(p.amount)}</p>
                <p className="mt-1 text-xs text-neutral-600">{rupeesInWords(p.amount)}</p>
              </section>

              <section className="mt-5">
                <h3 className="mb-2 text-sm font-semibold">Applied to invoices</h3>
                {p.allocations.length === 0 ? (
                  <p className="text-sm text-neutral-500">Not applied to any invoice yet; the full amount is held on account.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-neutral-200 text-xs uppercase text-neutral-500">
                        <tr>
                          <th className="py-2 pr-3">Invoice</th>
                          <th className="py-2 pr-3">Invoice date</th>
                          <th className="py-2 text-right">Amount applied</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {p.allocations.map((a) => {
                          const inv = invoices.data?.find((i) => i.id === a.invoiceId);
                          return (
                            <tr key={a.invoiceId}>
                              <td className="py-2 pr-3">
                                <Link to={`/sales/invoices/${a.invoiceId}`} className="font-medium hover:underline">
                                  {inv?.invoiceNo ?? a.invoiceId}
                                </Link>
                              </td>
                              <td className="py-2 pr-3">{formatDate(inv?.date)}</td>
                              <td className="tabular py-2 text-right">{formatCurrency(a.amount)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <dl className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-neutral-600">Total applied</dt>
                    <dd className="tabular">{formatCurrency(p.allocated)}</dd>
                  </div>
                  <div className="flex justify-between font-medium">
                    <dt>On account (unallocated)</dt>
                    <dd className="tabular">{formatCurrency(p.unallocated)}</dd>
                  </div>
                </dl>
              </section>
              <footer className="mt-8 flex justify-between text-xs text-neutral-500">
                <span>This is a computer-generated receipt.</span>
                <span>Authorised signatory</span>
              </footer>
            </article>
            <AllocationModal payment={allocating ? p : null} onClose={() => setAllocating(false)} />
          </>
        );
      }}
    </Loadable>
  );
}
