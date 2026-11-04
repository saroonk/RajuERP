import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PackageCheck } from 'lucide-react';
import { Can } from '@/app/AuthContext';
import { DataTable, type Column } from '@/components/data/DataTable';
import { LinkButton } from '@/components/ui/Button';
import { FilterSelect } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { GoodsReceiptRow } from '@/types';
import { formatCurrency, formatDate } from '@/utils/format';

export default function GoodsReceiptsPage() {
  const receipts = useData(() => services.purchases.receipts.list());
  const lk = useLookups();
  const navigate = useNavigate();
  const [supplier, setSupplier] = useState('');
  const rows = useMemo(() => receipts.data?.filter((r) => !supplier || r.supplierId === supplier), [receipts.data, supplier]);

  const columns: Column<GoodsReceiptRow>[] = [
    { key: 'grn', header: 'GRN no', value: (r) => r.grnNo, cell: (r) => <Link className="font-medium hover:underline" to={`/purchases/receipts/${r.id}`}>{r.grnNo}</Link>, primary: true },
    { key: 'date', header: 'Date', value: (r) => r.date, cell: (r) => formatDate(r.date), csv: (r) => r.date },
    { key: 'supplier', header: 'Supplier', value: (r) => r.supplierName },
    { key: 'po', header: 'PO no', value: (r) => r.poNo, cell: (r) => <Link className="hover:underline" to={`/purchases/orders/${r.poId}`}>{r.poNo}</Link> },
    { key: 'inv', header: 'Supplier invoice', value: (r) => r.supplierInvoiceNo },
    { key: 'taxable', header: 'Taxable', align: 'right', value: (r) => r.taxable, cell: (r) => formatCurrency(r.taxable) },
    { key: 'tax', header: 'GST', align: 'right', value: (r) => r.tax, cell: (r) => formatCurrency(r.tax) },
    { key: 'total', header: 'Total', align: 'right', value: (r) => r.total, cell: (r) => formatCurrency(r.total) },
  ];

  return (
    <>
      <PageHeader
        title="Goods receipts"
        description="Goods received against purchase orders. Each receipt adds batch-level stock."
        actions={
          <Can module="purchases">
            <LinkButton to="/purchases/receipts/new" icon={<PackageCheck className="h-4 w-4" />}>
              Receive goods
            </LinkButton>
          </Can>
        }
      />
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={receipts.loading}
        error={receipts.error}
        onRetry={receipts.reload}
        searchText={(r) => `${r.grnNo} ${r.supplierName} ${r.poNo} ${r.supplierInvoiceNo}`}
        searchPlaceholder="Search GRN, PO, supplier…"
        exportName="goods-receipts"
        onRowClick={(r) => navigate(`/purchases/receipts/${r.id}`)}
        defaultSort={{ key: 'date', dir: 'desc' }}
        emptyTitle="No goods receipts yet"
        emptyDescription="Receive goods against an open purchase order to add stock."
        filters={<FilterSelect value={supplier} onChange={setSupplier} options={lk.suppliers.map((s) => ({ value: s.id, label: s.name }))} allLabel="All suppliers" />}
        summary={(rs) => <span className="tabular font-medium">Total: {formatCurrency(rs.reduce((s, r) => s + r.total, 0))}</span>}
      />
    </>
  );
}
