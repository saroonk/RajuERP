import { useMemo, useState } from 'react';
import { z } from 'zod';
import { ResourcePage } from '@/components/forms/ResourcePage';
import { FilterSelect } from '@/components/ui/Inputs';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import type { Column } from '@/components/data/DataTable';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { Product } from '@/types';
import { formatCurrency, formatNumber, formatPercent } from '@/utils/format';
import { GST_RATES } from '@/utils/gst';
import { numberField, optionalText, requiredText } from '@/utils/schemas';
import type { FieldDef } from '@/components/forms/FormFields';

export default function ProductsPage() {
  const lk = useLookups();
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');

  const schema = useMemo(
    () =>
      z
        .object({
          sku: requiredText('SKU', 30),
          name: requiredText('Product name'),
          brandId: requiredText('Brand'),
          categoryId: requiredText('Category'),
          subcategoryId: z.string(),
          unitId: requiredText('Base unit'),
          packUnitId: requiredText('Pack unit'),
          packSize: numberField('Pack size', { int: true, min: 1 }),
          purchasePrice: numberField('Purchase price', { positive: true }),
          sellingPrice: numberField('Selling price', { positive: true }),
          gstRate: numberField('GST rate', { min: 0, max: 28 }),
          hsnCode: optionalText(10),
          minStock: numberField('Minimum stock', { int: true, min: 0 }),
          active: z.boolean(),
        })
        .refine((v) => !v.subcategoryId || lk.category(v.subcategoryId)?.parentId === v.categoryId, {
          message: 'Subcategory does not belong to the selected category',
          path: ['subcategoryId'],
        }),
    [lk],
  );

  const unitOptions = lk.units.map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }));
  const fields: FieldDef[] = [
    { name: 'sku', label: 'SKU', type: 'text', required: true, placeholder: 'e.g. RC-TEA-250' },
    { name: 'name', label: 'Product name', type: 'text', required: true },
    { name: 'brandId', label: 'Brand', type: 'select', required: true, options: lk.brands.map((b) => ({ value: b.id, label: b.name })) },
    { name: 'categoryId', label: 'Category', type: 'select', required: true, options: lk.topCategories.map((c) => ({ value: c.id, label: c.name })) },
    {
      name: 'subcategoryId',
      label: 'Subcategory',
      type: 'select',
      emptyLabel: 'None',
      options: lk.subcategories.map((s) => ({ value: s.id, label: `${lk.category(s.parentId)?.name ?? ''} › ${s.name}` })),
    },
    { name: 'unitId', label: 'Base unit', type: 'select', required: true, options: unitOptions, hint: 'All stock quantities are kept in this unit' },
    { name: 'packUnitId', label: 'Pack unit', type: 'select', required: true, options: unitOptions },
    { name: 'packSize', label: 'Pack size (base units per pack)', type: 'number', required: true, step: '1', min: 1 },
    { name: 'minStock', label: 'Minimum stock (base units)', type: 'number', required: true, step: '1', min: 0, hint: 'Low-stock alert threshold' },
    { name: 'purchasePrice', label: 'Purchase price (₹)', type: 'number', required: true, min: 0 },
    { name: 'sellingPrice', label: 'Selling price (₹)', type: 'number', required: true, min: 0 },
    { name: 'gstRate', label: 'GST rate (%)', type: 'select', numeric: true, required: true, options: GST_RATES.map((r) => ({ value: String(r), label: `${r}%` })) },
    { name: 'hsnCode', label: 'HSN code', type: 'text' },
    { name: 'active', label: 'Active', type: 'checkbox' },
  ];

  const columns: Column<Product>[] = [
    { key: 'sku', header: 'SKU', value: (p) => p.sku },
    { key: 'name', header: 'Product', value: (p) => p.name, primary: true, cell: (p) => <span className="font-medium text-neutral-900">{p.name}</span> },
    {
      key: 'brand',
      header: 'Brand',
      value: (p) => lk.brand(p.brandId)?.name,
      cell: (p) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {lk.brand(p.brandId)?.name}
          {lk.brand(p.brandId) && <Badge tone={lk.brand(p.brandId)!.type === 'own' ? 'dark' : 'neutral'}>{lk.brand(p.brandId)!.type === 'own' ? 'Own' : 'External'}</Badge>}
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      value: (p) => `${lk.category(p.categoryId)?.name ?? ''}${p.subcategoryId ? ` › ${lk.category(p.subcategoryId)?.name ?? ''}` : ''}`,
    },
    {
      key: 'pack',
      header: 'Unit / pack',
      value: (p) => `${p.packSize} ${lk.unit(p.unitId)?.code ?? ''} / ${lk.unit(p.packUnitId)?.code ?? ''}`,
    },
    { key: 'purchase', header: 'Purchase', align: 'right', value: (p) => p.purchasePrice, cell: (p) => formatCurrency(p.purchasePrice) },
    { key: 'selling', header: 'Selling', align: 'right', value: (p) => p.sellingPrice, cell: (p) => formatCurrency(p.sellingPrice) },
    {
      key: 'margin',
      header: 'Margin',
      align: 'right',
      value: (p) => Math.round(((p.sellingPrice - p.purchasePrice) / p.sellingPrice) * 1000) / 10,
      cell: (p) => formatPercent(((p.sellingPrice - p.purchasePrice) / p.sellingPrice) * 100),
    },
    { key: 'gst', header: 'GST', align: 'right', value: (p) => p.gstRate, cell: (p) => `${p.gstRate}%` },
    { key: 'min', header: 'Min stock', align: 'right', value: (p) => p.minStock, cell: (p) => formatNumber(p.minStock) },
    { key: 'status', header: 'Status', value: (p) => (p.active ? 'Active' : 'Inactive'), cell: (p) => <StatusBadge status={p.active ? 'active' : 'inactive'} /> },
  ];

  return (
    <ResourcePage<Product>
      title="Product master"
      description="Own-brand and third-party products with pricing, GST and packaging."
      breadcrumbs={[{ label: 'Products' }, { label: 'Product master' }]}
      module="products"
      entityName="product"
      service={services.products}
      columns={columns}
      fields={fields}
      schema={schema}
      defaults={{ sku: '', name: '', brandId: '', categoryId: '', subcategoryId: '', unitId: 'unit-pcs', packUnitId: '', packSize: 1, purchasePrice: NaN, sellingPrice: NaN, gstRate: 18, hsnCode: '', minStock: 0, active: true }}
      toForm={(p) => ({ ...p, subcategoryId: p.subcategoryId ?? '', hsnCode: p.hsnCode ?? '' })}
      toInput={(v) => ({ ...v, subcategoryId: v.subcategoryId || null, hsnCode: v.hsnCode || undefined })}
      nameOf={(p) => p.name}
      searchText={(p) => `${p.sku} ${p.name} ${lk.brand(p.brandId)?.name ?? ''}`}
      exportName="products"
      dialogSize="lg"
      defaultSort={{ key: 'name', dir: 'asc' }}
      filterFn={(p) => (!brand || p.brandId === brand) && (!category || p.categoryId === category) && (!status || (status === 'active') === p.active)}
      filters={
        <>
          <FilterSelect value={brand} onChange={setBrand} allLabel="All brands" options={lk.brands.map((b) => ({ value: b.id, label: b.name }))} />
          <FilterSelect value={category} onChange={setCategory} allLabel="All categories" options={lk.topCategories.map((c) => ({ value: c.id, label: c.name }))} />
          <FilterSelect
            value={status}
            onChange={setStatus}
            allLabel="All statuses"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
          />
        </>
      }
    />
  );
}
