import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CreditCard, FileMinus, Printer, RotateCcw } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Loadable } from '@/components/ui/States';
import { PageHeader } from '@/components/ui/PageHeader';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { InvoiceRow } from '@/types';
import { formatCurrency, formatDate, formatNumber } from '@/utils/format';
import { rupeesInWords } from '../utils/numberToWords';

export default function InvoiceDetailPage() {
  const { id = '' } = useParams();
  const state = useData(() => services.sales.invoices.get(id), [id]);
  return <Loadable state={state}>{(inv) => <Detail inv={inv} />}</Loadable>;
}

function Detail({ inv }: { inv: InvoiceRow }) {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const lookups = useLookups();
  const settings = useData(() => services.admin.settings());
  const batches = useData(() => services.inventory.batchStock());
  const payments = useData(() => services.accounts.payments.list());
  const notes = useData(() => services.sales.notes.list());
  const returns = useData(() => services.sales.returns.list());
  const s = settings.data;
  const ready = !!s && !!batches.data && !lookups.loading;

  useEffect(() => {
    if (params.get('print') === '1' && ready) {
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
  }, [params, ready]);

  const applied = payments.data?.filter((p) => p.allocations.some((a) => a.invoiceId === inv.id)) ?? [];
  const relNotes = notes.data?.filter((n) => n.invoiceId === inv.id) ?? [];
  const relReturns = returns.data?.filter((r) => r.invoiceId === inv.id) ?? [];
  const lineTotal = (l: InvoiceRow['lines'][number]) => l.taxable + l.cgst + l.sgst + l.igst;

  return (
    <>
      <PageHeader
        title={inv.invoiceNo}
        meta={
          <>
            <StatusBadge status={inv.payStatus} />
            {inv.overdue && <Badge tone="danger">Overdue {inv.daysOverdue}d</Badge>}
          </>
        }
        breadcrumbs={[{ label: 'Invoices', to: '/sales/invoices' }, { label: inv.invoiceNo }]}
        actions={
          <>
            <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print / Save as PDF</Button>
            {inv.payStatus !== 'paid' && can('receivables', 'edit') && <LinkButton to={`/accounts/payments/new?invoice=${inv.id}`} icon={<CreditCard className="h-4 w-4" />}>Record payment</LinkButton>}
            {can('sales', 'edit') && (
              <>
                <LinkButton variant="secondary" to={`/sales/returns/new?invoice=${inv.id}`} icon={<RotateCcw className="h-4 w-4" />}>Return goods</LinkButton>
                <LinkButton variant="secondary" to={`/sales/notes?invoice=${inv.id}`} icon={<FileMinus className="h-4 w-4" />}>Issue credit note</LinkButton>
              </>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_20rem] print:block">
        {/* Printable invoice */}
        <Card className="print-area min-w-0">
          <CardBody className="space-y-5 p-4 sm:p-6">
            <div className="flex flex-col justify-between gap-4 border-b border-neutral-200 pb-4 sm:flex-row">
              <div>
                <p className="text-lg font-bold">{s?.companyName}</p>
                <p className="mt-0.5 max-w-xs text-xs text-neutral-600">{s?.address}</p>
                <p className="text-xs text-neutral-600">GSTIN: {s?.gstin} · State: {s?.state}</p>
                <p className="text-xs text-neutral-600">{s?.phone} · {s?.email}</p>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-base font-semibold uppercase tracking-wide">Tax Invoice</p>
                <p className="mt-1 text-xs">Invoice no: <b>{inv.invoiceNo}</b></p>
                <p className="text-xs">Date: {formatDate(inv.date)}</p>
                <p className="text-xs">Due date: {formatDate(inv.dueDate)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase text-neutral-500">Bill to / Ship to</p>
                <p className="text-sm font-medium">{inv.distributorName}</p>
                <p className="text-neutral-600">{lookups.distributor(inv.distributorId)?.address}, {lookups.distributor(inv.distributorId)?.city}</p>
                <p className="text-neutral-600">GSTIN: {inv.distributorGstin || '—'} · State: {inv.distributorState}</p>
              </div>
              <div className="space-y-0.5 text-neutral-600">
                <p>Place of supply: <b className="text-neutral-900">{inv.distributorState}</b> ({inv.interState ? 'Inter-state, IGST' : 'Intra-state, CGST + SGST'})</p>
                <p>Order: {inv.orderNo}</p>
                <p>Dispatch: {inv.dispatchNo}</p>
              </div>
            </div>

            <div className="invoice-scroll overflow-x-auto rounded-xl ring-1 ring-slate-900/[0.08]">
              <table className="invoice-table w-full min-w-[56rem] text-left text-xs">
                <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-2 py-2">#</th>
                    <th className="px-2 py-2">Product</th>
                    <th className="px-2 py-2">HSN</th>
                    <th className="px-2 py-2">Batch</th>
                    <th className="px-2 py-2 text-right">Qty</th>
                    <th className="px-2 py-2 text-right">Rate</th>
                    <th className="px-2 py-2 text-right">Disc %</th>
                    <th className="px-2 py-2 text-right">Taxable</th>
                    <th className="px-2 py-2 text-right">GST %</th>
                    {inv.interState ? <th className="px-2 py-2 text-right">IGST</th> : (<><th className="px-2 py-2 text-right">CGST</th><th className="px-2 py-2 text-right">SGST</th></>)}
                    <th className="px-2 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {inv.lines.map((l, i) => (
                    <tr key={`${l.productId}-${l.batchId}-${i}`}>
                      <td className="px-2 py-2">{i + 1}</td>
                      <td className="px-2 py-2 font-medium">{lookups.productName(l.productId)}</td>
                      <td className="px-2 py-2">{lookups.product(l.productId)?.hsnCode ?? '—'}</td>
                      <td className="px-2 py-2">{batches.data?.find((b) => b.id === l.batchId)?.batchNo ?? '—'}</td>
                      <td className="tabular px-2 py-2 text-right">{formatNumber(l.qty)}</td>
                      <td className="tabular px-2 py-2 text-right">{formatCurrency(l.rate)}</td>
                      <td className="tabular px-2 py-2 text-right">{l.discountPct || 0}</td>
                      <td className="tabular px-2 py-2 text-right">{formatCurrency(l.taxable)}</td>
                      <td className="tabular px-2 py-2 text-right">{l.gstRate}%</td>
                      {inv.interState ? <td className="tabular px-2 py-2 text-right">{formatCurrency(l.igst)}</td> : (<><td className="tabular px-2 py-2 text-right">{formatCurrency(l.cgst)}</td><td className="tabular px-2 py-2 text-right">{formatCurrency(l.sgst)}</td></>)}
                      <td className="tabular px-2 py-2 text-right font-medium">{formatCurrency(lineTotal(l))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
              <div className="max-w-sm text-xs">
                <p className="font-semibold">Amount in words</p>
                <p className="mt-0.5 text-neutral-700">{rupeesInWords(inv.total)}</p>
                <p className="mt-3 font-semibold">Terms &amp; conditions</p>
                <p className="mt-0.5 text-neutral-600">{s?.invoiceTerms}</p>
              </div>
              <dl className="w-full space-y-1 text-sm sm:w-64">
                <TotalRow label="Taxable value" value={inv.taxable} />
                {inv.interState ? <TotalRow label="IGST" value={inv.igst} /> : (<><TotalRow label="CGST" value={inv.cgst} /><TotalRow label="SGST" value={inv.sgst} /></>)}
                <TotalRow label="Round off" value={inv.roundOff} />
                <TotalRow label="Grand total" value={inv.total} strong />
              </dl>
            </div>

            <div className="grid grid-cols-2 gap-8 pt-8 text-xs text-neutral-600">
              <p className="border-t border-neutral-300 pt-1">Customer signature</p>
              <p className="border-t border-neutral-300 pt-1 text-right">For {s?.companyName} — Authorised signatory</p>
            </div>
          </CardBody>
        </Card>

        {/* Side panels (not printed) */}
        <div className="no-print space-y-4">
          <Card>
            <CardHeader title="Payment summary" />
            <CardBody className="space-y-1.5 text-sm">
              <TotalRow label="Invoice total" value={inv.total} />
              <TotalRow label="Payments received" value={-inv.paid} />
              <TotalRow label="Credit notes" value={-inv.credited} />
              <TotalRow label="Debit notes" value={inv.debited} />
              <TotalRow label="Outstanding" value={inv.outstanding} strong />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Payments applied" />
            <CardBody className="space-y-2 text-sm">
              {applied.length === 0 && <p className="text-neutral-500">No payments allocated yet.</p>}
              {applied.map((p) => (
                <div key={p.id} className="flex justify-between gap-2">
                  <Link to={`/accounts/payments/${p.id}`} className="hover:underline">{p.receiptNo} · {formatDate(p.date)}</Link>
                  <span className="tabular">{formatCurrency(p.allocations.find((a) => a.invoiceId === inv.id)!.amount)}</span>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Returns & notes" />
            <CardBody className="space-y-2 text-sm">
              {relReturns.length + relNotes.length === 0 && <p className="text-neutral-500">No returns or notes against this invoice.</p>}
              {relReturns.map((r) => (
                <div key={r.id} className="flex justify-between gap-2">
                  <Link to={`/sales/returns/${r.id}`} className="hover:underline">{r.returnNo} (return)</Link>
                  <span className="tabular">{formatNumber(r.totalQty)} units</span>
                </div>
              ))}
              {relNotes.map((n) => (
                <div key={n.id} className="flex justify-between gap-2">
                  <span>{n.noteNo} ({n.type})</span>
                  <span className="tabular">{formatCurrency(n.total)}</span>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'border-t border-neutral-300 pt-1.5 font-semibold' : ''}`}>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="tabular">{formatCurrency(value)}</dd>
    </div>
  );
}
