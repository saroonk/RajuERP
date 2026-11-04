import { useMemo, useState } from 'react';
import { z } from 'zod';
import { ResourcePage } from '@/components/forms/ResourcePage';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import type { Column } from '@/components/data/DataTable';
import type { FieldDef } from '@/components/forms/FormFields';
import { useLookups } from '@/hooks/useLookups';
import { services } from '@/services';
import type { Unit, UnitConversion } from '@/types';
import { formatNumber } from '@/utils/format';
import { numberField, requiredText } from '@/utils/schemas';

const unitSchema = z.object({ name: requiredText('Unit name', 40), code: requiredText('Short code', 10) });
const unitFields: FieldDef[] = [
  { name: 'name', label: 'Unit name', type: 'text', required: true, placeholder: 'e.g. Carton' },
  { name: 'code', label: 'Short code', type: 'text', required: true, placeholder: 'e.g. Ctn' },
];
const unitColumns: Column<Unit>[] = [
  { key: 'name', header: 'Unit', value: (u) => u.name, primary: true },
  { key: 'code', header: 'Code', value: (u) => u.code },
];

function UnitsTab() {
  return (
    <ResourcePage<Unit>
      embedded
      title="Units"
      description="Units used for stocking and packaging products."
      module="products"
      entityName="unit"
      service={services.units}
      columns={unitColumns}
      fields={unitFields}
      schema={unitSchema}
      defaults={{ name: '', code: '' }}
      nameOf={(u) => u.name}
      searchText={(u) => `${u.name} ${u.code}`}
      dialogSize="sm"
    />
  );
}

function ConversionsTab() {
  const lk = useLookups();
  const schema = useMemo(
    () =>
      z
        .object({
          fromUnitId: requiredText('From unit'),
          toUnitId: requiredText('To unit'),
          factor: numberField('Factor', { positive: true }),
        })
        .refine((v) => v.fromUnitId !== v.toUnitId, { message: 'Choose two different units', path: ['toUnitId'] }),
    [],
  );
  const options = lk.units.map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }));
  const fields: FieldDef[] = [
    { name: 'fromUnitId', label: 'From unit (1 of …)', type: 'select', required: true, options },
    { name: 'toUnitId', label: 'To unit', type: 'select', required: true, options },
    { name: 'factor', label: 'Quantity in the to-unit', type: 'number', required: true, hint: 'e.g. 12 means 1 Box = 12 Pcs' },
  ];
  const columns: Column<UnitConversion>[] = [
    {
      key: 'rule',
      header: 'Conversion',
      primary: true,
      value: (c) => `1 ${lk.unit(c.fromUnitId)?.name ?? ''} = ${formatNumber(c.factor)} ${lk.unit(c.toUnitId)?.name ?? ''}`,
    },
    { key: 'from', header: 'From', value: (c) => lk.unit(c.fromUnitId)?.name ?? '' },
    { key: 'to', header: 'To', value: (c) => lk.unit(c.toUnitId)?.name ?? '' },
    { key: 'factor', header: 'Factor', align: 'right', value: (c) => c.factor },
  ];
  return (
    <ResourcePage<UnitConversion>
      embedded
      title="Conversions"
      description="Configurable unit conversions, e.g. 1 Carton = 4 Boxes."
      module="products"
      entityName="conversion"
      service={services.unitConversions}
      columns={columns}
      fields={fields}
      schema={schema}
      defaults={{ fromUnitId: '', toUnitId: '', factor: NaN }}
      nameOf={(c) => `${lk.unit(c.fromUnitId)?.name ?? ''} to ${lk.unit(c.toUnitId)?.name ?? ''}`}
      searchText={(c) => `${lk.unit(c.fromUnitId)?.name ?? ''} ${lk.unit(c.toUnitId)?.name ?? ''}`}
      dialogSize="sm"
    />
  );
}

export default function UnitsPage() {
  const [tab, setTab] = useState('units');
  return (
    <>
      <PageHeader
        title="Units & packaging"
        description="Stock is held in each product's base unit. A product's pack size (set in the product master) defines how many base units make one pack."
        breadcrumbs={[{ label: 'Products' }, { label: 'Units & packaging' }]}
      />
      <Tabs
        tabs={[
          { key: 'units', label: 'Units' },
          { key: 'conversions', label: 'Conversions' },
        ]}
        value={tab}
        onChange={setTab}
        className="mb-4"
      />
      {tab === 'units' ? <UnitsTab /> : <ConversionsTab />}
    </>
  );
}
