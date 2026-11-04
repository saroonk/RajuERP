import { useState } from 'react';
import { z } from 'zod';
import { ResourcePage } from '@/components/forms/ResourcePage';
import { FilterSelect } from '@/components/ui/Inputs';
import { StatusBadge } from '@/components/ui/Badge';
import type { Column } from '@/components/data/DataTable';
import type { FieldDef } from '@/components/forms/FormFields';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { Brand } from '@/types';
import { optionalText, requiredText } from '@/utils/schemas';

const schema = z.object({
  name: requiredText('Brand name', 80),
  type: z.enum(['own', 'external'], { required_error: 'Select a brand type' }),
  notes: optionalText(200),
  active: z.boolean(),
});

const fields: FieldDef[] = [
  { name: 'name', label: 'Brand name', type: 'text', required: true, wide: true },
  {
    name: 'type',
    label: 'Brand type',
    type: 'select',
    required: true,
    options: [
      { value: 'own', label: 'Own brand (company-owned)' },
      { value: 'external', label: 'External brand (third-party)' },
    ],
  },
  { name: 'active', label: 'Active', type: 'checkbox' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

export default function BrandsPage() {
  const lk = useLookups();
  const [type, setType] = useState('');
  const columns: Column<Brand>[] = [
    { key: 'name', header: 'Brand', value: (b) => b.name, primary: true, cell: (b) => <span className="font-medium text-neutral-900">{b.name}</span> },
    { key: 'type', header: 'Type', value: (b) => b.type, cell: (b) => <StatusBadge status={b.type} label={b.type === 'own' ? 'Own brand' : 'External'} /> },
    { key: 'products', header: 'Products', align: 'right', value: (b) => lk.products.filter((p) => p.brandId === b.id).length },
    { key: 'notes', header: 'Notes', value: (b) => b.notes ?? '', hideOnMobile: true },
    { key: 'status', header: 'Status', value: (b) => (b.active ? 'Active' : 'Inactive'), cell: (b) => <StatusBadge status={b.active ? 'active' : 'inactive'} /> },
  ];
  return (
    <ResourcePage<Brand>
      title="Brands"
      description="Keep company-owned brands separate from third-party brands."
      breadcrumbs={[{ label: 'Products' }, { label: 'Brands' }]}
      module="products"
      entityName="brand"
      service={services.brands}
      columns={columns}
      fields={fields}
      schema={schema}
      defaults={{ name: '', type: 'own', notes: '', active: true }}
      toForm={(b) => ({ ...b, notes: b.notes ?? '' })}
      nameOf={(b) => b.name}
      searchText={(b) => `${b.name} ${b.notes ?? ''}`}
      exportName="brands"
      dialogSize="sm"
      defaultSort={{ key: 'name', dir: 'asc' }}
      filterFn={(b) => !type || b.type === type}
      filters={
        <FilterSelect
          value={type}
          onChange={setType}
          allLabel="All brand types"
          options={[
            { value: 'own', label: 'Own brands' },
            { value: 'external', label: 'External brands' },
          ]}
        />
      }
    />
  );
}
