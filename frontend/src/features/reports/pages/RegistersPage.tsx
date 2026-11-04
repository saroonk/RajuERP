import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Tabs } from '@/components/ui/Tabs';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { PurchaseRegisterRow, SalesRegisterRow } from '@/types';
import { formatCurrency, formatDate } from '@/utils/format';
import { ReportShell, useReportRange } from '../components/ReportShell';

interface Totals {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

const sum = (rows: Totals[]): Totals => ({
  taxable: rows.reduce((s, r) => s + r.taxable, 0),
  cgst: rows.reduce((s, r) => s + r.cgst, 0),
  sgst: rows.reduce((s, r) => s + r.sgst, 0),
  igst: rows.reduce((s, r) => s + r.igst, 0),
  total: rows.reduce((s, r) => s + r.total, 0),
});

function TotalsBar({ label, t }: { label: string; t: Totals }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-neutral-600">{label}</span>
      <span className="tabular flex flex-wrap gap-x-4 text-xs sm:text-sm">
        <span>Taxable <b>{formatCurrency(t.taxable)}</b></span>
        <span>CGST <b>{formatCurrency(t.cgst)}</b></span>
        <span>SGST <b>{formatCurrency(t.sgst)}</b></span>
        <span>IGST <b>{formatCurrency(t.igst)}</b></span>
        <span>Total <b>{formatCurrency(t.total)}</b></span>
      </span>
    </div>
  );
}

export default function RegistersPage() {
  const [range, setRange] = useReportRange();
  const [tab, setTab] = useState('sales');
  const sales = useData(() => services.reports.salesRegister(range), [range.from, range.to]);
  const purchases = useData(() => services.reports.purchaseRegister(range), [range.from, range.to]);

  const taxCols = <T extends Totals>(): Column<T>[] => [
    { key: 'taxable', header: 'Taxable', align: 'right', value: (r) => r.taxable, cell: (r) => formatCurrency(r.taxable) },
    { key: 'cgst', header: 'CGST', align: 'right', value: (r) => r.cgst, cell: (r) => formatCurrency(r.cgst) },
    { key: 'sgst', header: 'SGST', align: 'right', value: (r) => r.sgst, cell: (r) => formatCurrency(r.sgst) },
    { key: 'igst', header: 'IGST', align: 'right', value: (r) => r.igst, cell: (r) => formatCurrency(r.igst) },
  ];

  const salesCols: Column<SalesRegisterRow>[] = [
    { key: 'no', header: 'Invoice', value: (r) => r.invoiceNo, primary: true, cell: (r) => <Link to={`/sales/invoices/${r.invoiceId}`} className="font-medium hover:underline">{r.invoiceNo}</Link> },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date) },
    { key: 'party', header: 'Distributor', value: (r) => r.distributorName },
    { key: 'gstin', header: 'GSTIN', value: (r) => r.gstin, hideOnMobile: true },
    ...taxCols<SalesRegisterRow>(),
    { key: 'round', header: 'Round-off', align: 'right', value: (r) => r.roundOff, cell: (r) => formatCurrency(r.roundOff), hideOnMobile: true },
    { key: 'total', header: 'Total', align: 'right', value: (r) => r.total, cell: (r) => <span className="font-semibold">{formatCurrency(r.total)}</span> },
  ];

  const purchaseCols: Column<PurchaseRegisterRow>[] = [
    { key: 'no', header: 'GRN', value: (r) => r.grnNo, primary: true, cell: (r) => <Link to={`/purchases/receipts/${r.grnId}`} className="font-medium hover:underline">{r.grnNo}</Link> },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date) },
    { key: 'party', header: 'Supplier', value: (r) => r.supplierName },
    { key: 'sinv', header: 'Supplier invoice', value: (r) => r.supplierInvoiceNo, hideOnMobile: true },
    { key: 'gstin', header: 'GSTIN', value: (r) => r.gstin, hideOnMobile: true },
    ...taxCols<PurchaseRegisterRow>(),
    { key: 'total', header: 'Total', align: 'right', value: (r) => r.total, cell: (r) => <span className="font-semibold">{formatCurrency(r.total)}</span> },
  ];

  const s = sales.data ?? [];
  const p = purchases.data ?? [];
  return (
    <ReportShell
      title="Purchase & sales registers"
      description="Chronological registers of invoices and goods receipts with tax split."
      range={range}
      onRangeChange={setRange}
      kpis={[
        { label: 'Sales (taxable)', value: formatCurrency(sum(s).taxable), hint: `${s.length} invoices` },
        { label: 'Output GST', value: formatCurrency(sum(s).cgst + sum(s).sgst + sum(s).igst) },
        { label: 'Purchases (taxable)', value: formatCurrency(sum(p).taxable), hint: `${p.length} receipts` },
        { label: 'Input GST', value: formatCurrency(sum(p).cgst + sum(p).sgst + sum(p).igst) },
      ]}
    >
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'sales', label: 'Sales register', count: s.length }, { key: 'purchases', label: 'Purchase register', count: p.length }]} />
      {tab === 'sales' ? (
        <DataTable
          data={s}
          columns={salesCols}
          rowKey={(r) => r.invoiceId}
          loading={sales.loading}
          error={sales.error}
          onRetry={sales.reload}
          searchText={(r) => `${r.invoiceNo} ${r.distributorName} ${r.gstin}`}
          searchPlaceholder="Search sales register…"
          exportName="sales-register"
          defaultSort={{ key: 'date', dir: 'desc' }}
          pageSize={25}
          emptyTitle="No invoices in this period"
          summary={(rows) => <TotalsBar label={`${rows.length} invoices`} t={sum(rows)} />}
        />
      ) : (
        <DataTable
          data={p}
          columns={purchaseCols}
          rowKey={(r) => r.grnId}
          loading={purchases.loading}
          error={purchases.error}
          onRetry={purchases.reload}
          searchText={(r) => `${r.grnNo} ${r.supplierName} ${r.supplierInvoiceNo} ${r.gstin}`}
          searchPlaceholder="Search purchase register…"
          exportName="purchase-register"
          defaultSort={{ key: 'date', dir: 'desc' }}
          pageSize={25}
          emptyTitle="No goods receipts in this period"
          summary={(rows) => <TotalsBar label={`${rows.length} receipts`} t={sum(rows)} />}
        />
      )}
    </ReportShell>
  );
}
