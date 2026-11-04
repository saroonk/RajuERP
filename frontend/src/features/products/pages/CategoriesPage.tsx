import { useMemo } from 'react';
import { z } from 'zod';
import { ResourcePage } from '@/components/forms/ResourcePage';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import type { Column } from '@/components/data/DataTable';
import type { FieldDef } from '@/components/forms/FormFields';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { Category } from '@/types';
import { requiredText } from '@/utils/schemas';

export default function CategoriesPage() {
  const lk = useLookups();

  const schema = useMemo(
    () =>
      z
        .object({
          id: z.string().optional(),
          name: requiredText('Name', 80),
          parentId: z.string(),
          active: z.boolean(),
        })
        .refine((v) => !v.id || v.parentId !== v.id, { message: 'A category cannot be its own parent', path: ['parentId'] })
        .refine((v) => !v.id || !v.parentId || !lk.categories.some((c) => c.parentId === v.id), {
          message: 'This category has subcategories, so it cannot become a subcategory',
          path: ['parentId'],
        }),
    [lk],
  );

  const fields: FieldDef[] = [
    { name: 'name', label: 'Name', type: 'text', required: true, wide: true },
    {
      name: 'parentId',
      label: 'Parent category',
      type: 'select',
      emptyLabel: 'None (top-level category)',
      options: lk.topCategories.map((c) => ({ value: c.id, label: c.name })),
      hint: 'Pick a parent to create a subcategory',
    },
    { name: 'active', label: 'Active', type: 'checkbox' },
  ];

  const productCount = (c: Category) => lk.products.filter((p) => (c.parentId ? p.subcategoryId === c.id : p.categoryId === c.id)).length;

  const columns: Column<Category>[] = [
    {
      key: 'name',
      header: 'Name',
      primary: true,
      value: (c) => (c.parentId ? `${lk.category(c.parentId)?.name ?? ''} › ${c.name}` : c.name),
      cell: (c) => (c.parentId ? <span className="pl-4 text-neutral-700">↳ {c.name}</span> : <span className="font-medium text-neutral-900">{c.name}</span>),
    },
    { key: 'level', header: 'Level', value: (c) => (c.parentId ? 'Subcategory' : 'Category'), cell: (c) => <Badge tone={c.parentId ? 'neutral' : 'dark'}>{c.parentId ? 'Subcategory' : 'Category'}</Badge> },
    { key: 'parent', header: 'Parent', value: (c) => lk.category(c.parentId)?.name ?? '' },
    { key: 'products', header: 'Products', align: 'right', value: productCount },
    { key: 'status', header: 'Status', value: (c) => (c.active ? 'Active' : 'Inactive'), cell: (c) => <StatusBadge status={c.active ? 'active' : 'inactive'} /> },
  ];

  return (
    <ResourcePage<Category>
      title="Categories & subcategories"
      description="Organise products by category and subcategory."
      breadcrumbs={[{ label: 'Products' }, { label: 'Categories' }]}
      module="products"
      entityName="category"
      service={services.categories}
      columns={columns}
      fields={fields}
      schema={schema}
      defaults={{ name: '', parentId: '', active: true }}
      toForm={(c) => ({ ...c, parentId: c.parentId ?? '' })}
      toInput={(v) => ({ name: v.name, parentId: v.parentId || null, active: v.active })}
      nameOf={(c) => c.name}
      searchText={(c) => `${c.name} ${lk.category(c.parentId)?.name ?? ''}`}
      exportName="categories"
      dialogSize="sm"
      defaultSort={{ key: 'name', dir: 'asc' }}
    />
  );
}
