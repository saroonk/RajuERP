import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';
import type { Column } from '@/components/data/DataTable';
import type { FieldDef } from '@/components/forms/FormFields';
import { ResourcePage } from '@/components/forms/ResourcePage';
import { FilterSelect } from '@/components/ui/Inputs';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { DistributorPrice } from '@/types';
import { formatCurrency, formatPercent, round2 } from '@/utils/format';
import { numberField, optionalText, requiredText } from '@/utils/schemas';

const schema = z.object({
  distributorId: requiredText('Distributor'),
  productId: requiredText('Product'),
  price: numberField('Price', { positive: true }),
  discountPct: numberField('Discount', { min: 0, max: 100 }),
  terms: optionalText(200),
});

export default function PricingPage() {
  const lk = useLookups();
  const [distributor, setDistributor] = useState('');
  const [product, setProduct] = useState('');
  const filterFn = useCallback((p: DistributorPrice) => (!distributor || p.distributorId === distributor) && (!product || p.productId === product), [distributor, product]);

  const distributorOptions = useMemo(() => lk.distributors.map((d) => ({ value: d.id, label: `${d.code} · ${d.name}` })), [lk.distributors]);
  const productOptions = useMemo(() => lk.products.map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` })), [lk.products]);

  const fields: FieldDef[] = useMemo(
    () => [
      { name: 'distributorId', label: 'Distributor', type: 'select', options: distributorOptions, required: true, wide: true },
      { name: 'productId', label: 'Product', type: 'select', options: productOptions, required: true, wide: true },
      { name: 'price', label: 'Net price per unit (₹)', type: 'number', required: true, hint: 'Before discount, excluding GST.' },
      { name: 'discountPct', label: 'Discount (%)', type: 'number', required: true, min: 0, max: 100 },
      { name: 'terms', label: 'Commercial terms', type: 'text', wide: true, placeholder: 'e.g. 3% trade discount on 10+ cases' },
    ],
    [distributorOptions, productOptions],
  );

  const columns: Column<DistributorPrice>[] = [
    { key: 'dist', header: 'Distributor', value: (r) => lk.distributor(r.distributorId)?.name ?? r.distributorId, primary: true },
    { key: 'prod', header: 'Product', value: (r) => `${lk.product(r.productId)?.sku ?? ''} ${lk.productName(r.productId)}`, cell: (r) => (<span>{lk.productName(r.productId)}<span className="block text-xs text-neutral-500">{lk.product(r.productId)?.sku}</span></span>), csv: (r) => lk.productName(r.productId) },
    { key: 'std', header: 'Standard price', align: 'right', value: (r) => lk.product(r.productId)?.sellingPrice ?? 0, cell: (r) => formatCurrency(lk.product(r.productId)?.sellingPrice) },
    { key: 'price', header: 'Special price', align: 'right', value: (r) => r.price, cell: (r) => formatCurrency(r.price) },
    { key: 'disc', header: 'Discount', align: 'right', value: (r) => r.discountPct, cell: (r) => formatPercent(r.discountPct) },
    { key: 'net', header: 'Effective net', align: 'right', value: (r) => round2(r.price * (1 - r.discountPct / 100)), cell: (r) => formatCurrency(round2(r.price * (1 - r.discountPct / 100))) },
    { key: 'terms', header: 'Terms', value: (r) => r.terms },
  ];

  return (
    <ResourcePage<DistributorPrice>
      title="Pricing & terms"
      description="Distributor-specific prices and discounts. They prefill new distribution orders."
      module="distributors"
      entityName="price"
      service={services.distributorPrices}
      columns={columns}
      fields={fields}
      schema={schema}
      defaults={{ distributorId: '', productId: '', price: 0, discountPct: 0, terms: '' }}
      nameOf={(r) => `${lk.distributor(r.distributorId)?.name ?? ''} / ${lk.productName(r.productId)}`}
      searchText={(r) => `${lk.distributor(r.distributorId)?.name ?? ''} ${lk.productName(r.productId)} ${lk.product(r.productId)?.sku ?? ''} ${r.terms}`}
      exportName="distributor-prices"
      filterFn={filterFn}
      defaultSort={{ key: 'dist', dir: 'asc' }}
      filters={
        <>
          <FilterSelect value={distributor} onChange={setDistributor} options={distributorOptions} allLabel="All distributors" />
          <FilterSelect value={product} onChange={setProduct} options={productOptions} allLabel="All products" />
        </>
      }
    />
  );
}
