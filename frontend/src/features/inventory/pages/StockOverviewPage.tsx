import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Boxes, Layers, ShoppingCart, Wallet } from 'lucide-react';
import { DataTable, type Column } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { StatCard } from '@/components/ui/Card';
import { FilterSelect } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { useData } from '@/hooks/useData';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { ProductStock } from '@/types';
import { formatCurrency, formatCurrencyWhole, formatNumber, formatPackQty } from '@/utils/format';

export default function StockOverviewPage() {
  const navigate = useNavigate();
  const lk = useLookups();
  const stock = useData(() => services.inventory.stockByProduct());
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');

  const rows = useMemo(
    () => stock.data?.filter((r) => (!brand || r.brandId === brand) && (!category || r.categoryId === category) && (!status || r.stockStatus === status)),
    [stock.data, brand, category, status],
  );

  const pack = (r: ProductStock, qty: number) => {
    const p = lk.product(r.productId);
    const packCode = lk.unit(p?.packUnitId)?.code;
    return packCode ? formatPackQty(qty, r.unitCode, r.packSize, packCode) : `${formatNumber(qty)} ${r.unitCode}`;
  };

  const all = stock.data ?? [];
  const kpi = {
    stocked: all.filter((r) => r.available > 0).length,
    value: all.reduce((s, r) => s + r.value, 0),
    low: all.filter((r) => r.stockStatus !== 'ok').length,
    out: all.filter((r) => r.stockStatus === 'out').length,
    expired: all.reduce((s, r) => s + r.expired, 0),
    damaged: all.reduce((s, r) => s + r.damaged, 0),
    inspection: all.reduce((s, r) => s + r.inspection, 0),
  };

  const columns: Column<ProductStock>[] = [
    { key: 'sku', header: 'SKU', value: (r) => r.sku },
    { key: 'name', header: 'Product', value: (r) => r.name, primary: true, cell: (r) => <span className="font-medium text-neutral-900">{r.name}</span> },
    { key: 'brand', header: 'Brand', value: (r) => r.brandName },
    { key: 'category', header: 'Category', value: (r) => r.categoryName, hideOnMobile: true },
    { key: 'available', header: 'Available', align: 'right', value: (r) => r.available, cell: (r) => pack(r, r.available), csv: (r) => r.available },
    { key: 'expired', header: 'Expired', align: 'right', value: (r) => r.expired, cell: (r) => (r.expired ? <span className="text-red-600">{formatNumber(r.expired)}</span> : '0') },
    { key: 'damaged', header: 'Damaged', align: 'right', value: (r) => r.damaged, cell: (r) => formatNumber(r.damaged) },
    { key: 'inspection', header: 'Inspection', align: 'right', value: (r) => r.inspection, cell: (r) => formatNumber(r.inspection) },
    { key: 'min', header: 'Min stock', align: 'right', value: (r) => r.minStock, cell: (r) => formatNumber(r.minStock) },
    { key: 'status', header: 'Status', value: (r) => r.stockStatus, cell: (r) => <StatusBadge status={r.stockStatus} /> },
    { key: 'value', header: 'Value', align: 'right', value: (r) => r.value, cell: (r) => formatCurrency(r.value) },
  ];

  return (
    <>
      <PageHeader title="Stock overview" description="Current stock by product across all batches. Only saleable, unexpired stock counts as available." breadcrumbs={[{ label: 'Inventory' }, { label: 'Stock overview' }]} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Products in stock" value={kpi.stocked} hint={`of ${all.length} products`} icon={<Boxes className="h-4 w-4" />} />
        <StatCard label="Saleable stock value" value={formatCurrencyWhole(kpi.value)} hint="At batch cost" icon={<Wallet className="h-4 w-4" />} />
        <StatCard label="Low / out of stock" value={kpi.low} hint={`${kpi.out} out of stock`} tone={kpi.low ? 'warning' : 'default'} icon={<AlertTriangle className="h-4 w-4" />} />
        <StatCard
          label="Held for disposition"
          value={`${formatNumber(kpi.expired + kpi.damaged + kpi.inspection)} units`}
          hint={`${formatNumber(kpi.expired)} expired · ${formatNumber(kpi.damaged)} damaged · ${formatNumber(kpi.inspection)} inspection`}
          tone={kpi.expired ? 'danger' : 'default'}
          icon={<Layers className="h-4 w-4" />}
          to="/inventory/batches"
        />
      </div>
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.productId}
        loading={stock.loading}
        error={stock.error}
        onRetry={stock.reload}
        searchText={(r) => `${r.sku} ${r.name} ${r.brandName} ${r.categoryName}`}
        searchPlaceholder="Search products…"
        exportName="stock-overview"
        defaultSort={{ key: 'name', dir: 'asc' }}
        emptyTitle="No products"
        filters={
          <>
            <FilterSelect value={brand} onChange={setBrand} allLabel="All brands" options={lk.brands.map((b) => ({ value: b.id, label: b.name }))} />
            <FilterSelect value={category} onChange={setCategory} allLabel="All categories" options={lk.topCategories.map((c) => ({ value: c.id, label: c.name }))} />
            <FilterSelect
              value={status}
              onChange={setStatus}
              allLabel="All stock levels"
              options={[
                { value: 'ok', label: 'In stock' },
                { value: 'low', label: 'Low stock' },
                { value: 'out', label: 'Out of stock' },
              ]}
            />
          </>
        }
        rowActions={(r) => [
          { label: 'View batches', icon: <Layers className="h-4 w-4" />, onClick: () => navigate(`/inventory/batches?product=${r.productId}`) },
          { label: 'Create purchase order', icon: <ShoppingCart className="h-4 w-4" />, onClick: () => navigate('/purchases/orders/new') },
        ]}
      />
    </>
  );
}
