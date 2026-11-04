import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Download, Info, Plus, Trash2, Upload } from 'lucide-react';
import { z } from 'zod';
import { useAuth } from '@/app/AuthContext';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/Confirm';
import { Field, FilterSelect, Input, Select, Textarea } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { ImportResult } from '@/services/types';
import type { DistributorStockReportRow, DistributorStockRow } from '@/types';
import { downloadCsv, parseCsv } from '@/utils/csv';
import { formatDate, formatMonth, formatNumber, monthKey, today } from '@/utils/format';
import { numberField, requiredText } from '@/utils/schemas';

const schema = z.object({
  distributorId: requiredText('Distributor'),
  productId: requiredText('Product'),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month'),
  reportedSales: numberField('Reported sales', { min: 0 }),
  remainingStock: numberField('Remaining stock', { min: 0 }),
  returned: numberField('Returned', { min: 0 }),
});
type Values = z.infer<typeof schema>;

export default function DistributorStockPage() {
  const { can } = useAuth();
  const canEdit = can('distribution', 'edit');
  const [tab, setTab] = useState('stock');
  const [distributor, setDistributor] = useState('');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const lk = useLookups();
  const stock = useData(() => services.distribution.stock());
  const reports = useData(() => services.distribution.stockReports());
  const confirm = useConfirm();
  const { run } = useAction();

  const distributorOptions = useMemo(() => lk.distributors.map((d) => ({ value: d.id, label: d.name })), [lk.distributors]);
  const stockRows = useMemo(() => stock.data?.filter((r) => !distributor || r.distributorId === distributor), [stock.data, distributor]);
  const reportRows = useMemo(() => reports.data?.filter((r) => !distributor || r.distributorId === distributor), [reports.data, distributor]);

  const stockCols: Column<DistributorStockRow>[] = [
    { key: 'dist', header: 'Distributor', value: (r) => r.distributorName, primary: true },
    { key: 'prod', header: 'Product', value: (r) => r.productName, cell: (r) => (<span>{r.productName}<span className="block text-xs text-neutral-500">{r.sku}</span></span>) },
    { key: 'disp', header: 'Dispatched', align: 'right', value: (r) => r.dispatched, cell: (r) => formatNumber(r.dispatched) },
    { key: 'ret', header: 'Returned to us', align: 'right', value: (r) => r.returnedToUs, cell: (r) => formatNumber(r.returnedToUs) },
    { key: 'sales', header: 'Reported sales', align: 'right', value: (r) => r.reportedSales, cell: (r) => (r.reportedSales === null ? <span className="text-neutral-400">Not reported</span> : formatNumber(r.reportedSales)) },
    { key: 'rem', header: 'Reported remaining', align: 'right', value: (r) => r.reportedRemaining, cell: (r) => (r.reportedRemaining === null ? <span className="text-neutral-400">Not reported</span> : formatNumber(r.reportedRemaining)) },
    { key: 'per', header: 'Last report', value: (r) => r.lastPeriod, cell: (r) => (r.lastPeriod ? formatMonth(r.lastPeriod) : '—'), csv: (r) => r.lastPeriod },
    {
      key: 'var',
      header: 'Unreconciled',
      align: 'right',
      value: (r) => r.unreconciled,
      cell: (r) => (r.unreconciled === null ? '—' : <Badge tone={r.unreconciled === 0 ? 'success' : 'warning'}>{formatNumber(r.unreconciled)}</Badge>),
    },
  ];

  const reportCols: Column<DistributorStockReportRow>[] = [
    { key: 'dist', header: 'Distributor', value: (r) => r.distributorName, primary: true },
    { key: 'prod', header: 'Product', value: (r) => r.productName },
    { key: 'per', header: 'Period', value: (r) => r.period, cell: (r) => formatMonth(r.period) },
    { key: 'sales', header: 'Reported sales', align: 'right', value: (r) => r.reportedSales, cell: (r) => formatNumber(r.reportedSales) },
    { key: 'rem', header: 'Remaining', align: 'right', value: (r) => r.remainingStock, cell: (r) => formatNumber(r.remainingStock) },
    { key: 'ret', header: 'Returned', align: 'right', value: (r) => r.returned, cell: (r) => formatNumber(r.returned) },
    { key: 'on', header: 'Reported on', value: (r) => r.reportedOn, cell: (r) => formatDate(r.reportedOn) },
    { key: 'src', header: 'Source', value: (r) => r.source, cell: (r) => <Badge>{r.source === 'import' ? 'Imported' : 'Manual'}</Badge> },
  ];

  const remove = async (r: DistributorStockReportRow) => {
    if (await confirm({ title: 'Delete report?', message: `Remove the ${formatMonth(r.period)} report for ${r.productName} from ${r.distributorName}?`, confirmLabel: 'Delete', danger: true })) {
      await run(() => services.distribution.deleteStockReport(r.id), 'Report deleted');
    }
  };

  const filter = <FilterSelect value={distributor} onChange={setDistributor} options={distributorOptions} allLabel="All distributors" />;

  return (
    <>
      <PageHeader
        title="Distributor stock"
        description="Compare what was dispatched with what distributors report selling and holding."
        actions={
          canEdit && (
            <>
              <Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => setImporting(true)}>Import CSV</Button>
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add report</Button>
            </>
          )
        }
      />
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <strong>Dispatched quantities are not distributor sales.</strong> Dispatch records only show what left our warehouse. Actual sales and remaining stock appear here only when a distributor reports them, or when you enter or import their reports.
        </p>
      </div>
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ key: 'stock', label: 'Dispatched vs reported' }, { key: 'reports', label: 'Reports received', count: reports.data?.length }]} />

      {tab === 'stock' ? (
        <DataTable data={stockRows} columns={stockCols} rowKey={(r) => `${r.distributorId}|${r.productId}`} loading={stock.loading} error={stock.error} onRetry={stock.reload} searchText={(r) => `${r.distributorName} ${r.productName} ${r.sku}`} filters={filter} exportName="distributor-stock" pageSize={25} emptyTitle="No dispatches yet" emptyDescription="Dispatch goods to a distributor to start tracking their stock." />
      ) : (
        <DataTable
          data={reportRows}
          columns={reportCols}
          rowKey={(r) => r.id}
          loading={reports.loading}
          error={reports.error}
          onRetry={reports.reload}
          searchText={(r) => `${r.distributorName} ${r.productName} ${r.period}`}
          filters={filter}
          exportName="distributor-reports"
          defaultSort={{ key: 'per', dir: 'desc' }}
          rowActions={(r) => [{ label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => remove(r), hidden: !canEdit }]}
          emptyTitle="No reports received"
          emptyDescription="Add a distributor's reported sales and remaining stock, or import them from a CSV file."
        />
      )}

      <AddReportModal open={adding} onClose={() => setAdding(false)} />
      <ImportModal open={importing} onClose={() => setImporting(false)} />
    </>
  );
}

function AddReportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const lk = useLookups();
  const { run, busy } = useAction();
  const { register, handleSubmit, reset, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { distributorId: '', productId: '', period: monthKey(today()), reportedSales: 0, remainingStock: 0, returned: 0 },
  });
  const { errors } = formState;
  const close = () => {
    reset();
    onClose();
  };
  const submit = handleSubmit(async (v) => {
    const ok = await run(() => services.distribution.addStockReport(v), 'Distributor report saved');
    if (ok) close();
  });
  return (
    <Modal
      open={open}
      onClose={close}
      locked={busy}
      title="Add distributor report"
      description="Enter figures supplied by the distributor. An existing report for the same month is replaced."
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
          <Button type="submit" form="stock-report-form" loading={busy}>Save report</Button>
        </>
      }
    >
      <form id="stock-report-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field label="Distributor" required error={errors.distributorId?.message} className="sm:col-span-2">
          <Select placeholder="Select distributor…" options={lk.distributors.map((d) => ({ value: d.id, label: d.name }))} {...register('distributorId')} />
        </Field>
        <Field label="Product" required error={errors.productId?.message} className="sm:col-span-2">
          <Select placeholder="Select product…" options={lk.products.map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))} {...register('productId')} />
        </Field>
        <Field label="Period" required error={errors.period?.message}>
          <Input type="month" {...register('period')} />
        </Field>
        <Field label="Reported sales" required error={errors.reportedSales?.message}>
          <Input type="number" inputMode="numeric" min={0} {...register('reportedSales', { valueAsNumber: true })} />
        </Field>
        <Field label="Remaining stock" required error={errors.remainingStock?.message}>
          <Input type="number" inputMode="numeric" min={0} {...register('remainingStock', { valueAsNumber: true })} />
        </Field>
        <Field label="Returned" required error={errors.returned?.message}>
          <Input type="number" inputMode="numeric" min={0} {...register('returned', { valueAsNumber: true })} />
        </Field>
      </form>
    </Modal>
  );
}

const TEMPLATE_HEADERS = ['distributorCode', 'sku', 'period', 'reportedSales', 'remainingStock', 'returned'];

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { run, busy } = useAction();
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileError, setFileError] = useState('');

  const close = () => {
    setText('');
    setResult(null);
    setFileError('');
    onClose();
  };

  const onFile = async (file: File | undefined) => {
    setFileError('');
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setFileError('Please choose a .csv file.');
      return;
    }
    setText(await file.text());
    setResult(null);
  };

  const submit = async () => {
    const rows = parseCsv(text);
    if (rows.length === 0) {
      setFileError('Add some CSV rows first.');
      return;
    }
    setFileError('');
    const r = await run(() => services.distribution.importStockReports(rows));
    if (r) setResult(r);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      locked={busy}
      size="lg"
      title="Import distributor reports"
      description="Columns: distributorCode, sku, period (YYYY-MM), reportedSales, remainingStock, returned."
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>{result ? 'Close' : 'Cancel'}</Button>
          <Button onClick={submit} loading={busy} disabled={!text.trim()}>Import</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => downloadCsv('distributor-report-template', TEMPLATE_HEADERS, [['D001', 'RC-TEA-250', monthKey(today()), 120, 48, 0]])}>
          Download template
        </Button>
        <Field label="CSV file" error={fileError}>
          <Input type="file" accept=".csv,text/csv" className="h-auto py-1.5" onChange={(e) => void onFile(e.target.files?.[0])} />
        </Field>
        <Field label="Or paste CSV rows" hint="A header row is optional.">
          <Textarea rows={6} value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} className="font-mono text-xs" />
        </Field>
        {result && (
          <div role="status" className="rounded-xl bg-slate-50/70 p-3.5 ring-1 ring-slate-900/[0.05] text-sm">
            <p className="font-medium">{result.imported} row{result.imported === 1 ? '' : 's'} imported{result.errors.length > 0 && `, ${result.errors.length} skipped`}.</p>
            {result.errors.length > 0 && (
              <ul className="mt-2 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs text-red-700">
                {result.errors.map((e) => (
                  <li key={e.row}>Row {e.row}: {e.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
