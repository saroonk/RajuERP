import { useCallback, useState } from 'react';
import { Banknote } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import type { Column } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { FilterSelect } from '@/components/ui/Inputs';
import type { FieldDef } from '@/components/forms/FormFields';
import { ResourcePage } from '@/components/forms/ResourcePage';
import { services } from '@/services';
import type { Supplier } from '@/types';
import { INDIAN_STATES } from '@/utils/gst';
import { emailField, gstinField, optionalText, phoneField, requiredText } from '@/utils/schemas';

const schema = z.object({
  name: requiredText('Supplier name'),
  contactPerson: optionalText(80),
  phone: phoneField,
  email: z.string().trim().refine((v) => v === '' || emailField.safeParse(v).success, 'Enter a valid email address'),
  gstin: gstinField,
  address: optionalText(200),
  city: optionalText(60),
  state: requiredText('State'),
  active: z.boolean(),
});

const states = INDIAN_STATES.map((s) => ({ value: s, label: s }));

const fields: FieldDef[] = [
  { name: 'name', label: 'Supplier name', type: 'text', required: true, wide: true },
  { name: 'contactPerson', label: 'Contact person', type: 'text' },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'gstin', label: 'GSTIN', type: 'text', placeholder: '29ABCDE1234F1Z5', hint: 'Used on purchase records and GST reports.' },
  { name: 'address', label: 'Address', type: 'text', wide: true },
  { name: 'city', label: 'City', type: 'text' },
  { name: 'state', label: 'State', type: 'select', options: states, required: true },
  { name: 'active', label: 'Active supplier', type: 'checkbox' },
];

export default function SuppliersPage() {
  const navigate = useNavigate();
  const [state, setState] = useState('');
  const [status, setStatus] = useState('');
  const filterFn = useCallback((s: Supplier) => (!state || s.state === state) && (!status || (status === 'active') === s.active), [state, status]);

  const columns: Column<Supplier>[] = [
    { key: 'name', header: 'Supplier', value: (r) => r.name, primary: true },
    { key: 'contact', header: 'Contact', value: (r) => r.contactPerson, cell: (r) => (<span>{r.contactPerson}<span className="block text-xs text-neutral-500">{r.phone}</span></span>), csv: (r) => `${r.contactPerson} ${r.phone}` },
    { key: 'email', header: 'Email', value: (r) => r.email },
    { key: 'gstin', header: 'GSTIN', value: (r) => r.gstin },
    { key: 'city', header: 'City / state', value: (r) => `${r.city}, ${r.state}` },
    { key: 'status', header: 'Status', value: (r) => (r.active ? 'active' : 'inactive'), cell: (r) => <StatusBadge status={r.active ? 'active' : 'inactive'} /> },
  ];

  return (
    <ResourcePage<Supplier>
      title="Suppliers"
      description="Supplier records with GSTIN and contact details."
      module="purchases"
      entityName="supplier"
      service={services.suppliers}
      columns={columns}
      fields={fields}
      schema={schema}
      defaults={{ name: '', contactPerson: '', phone: '', email: '', gstin: '', address: '', city: '', state: 'Karnataka', active: true }}
      nameOf={(s) => s.name}
      searchText={(s) => `${s.name} ${s.contactPerson} ${s.gstin} ${s.city} ${s.phone} ${s.email}`}
      exportName="suppliers"
      dialogSize="lg"
      filterFn={filterFn}
      defaultSort={{ key: 'name', dir: 'asc' }}
      extraRowActions={() => [{ label: 'View payables', icon: <Banknote className="h-4 w-4" />, onClick: () => navigate('/accounts/payables') }]}
      filters={
        <>
          <FilterSelect value={state} onChange={setState} options={states} allLabel="All states" />
          <FilterSelect value={status} onChange={setStatus} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} allLabel="All statuses" />
        </>
      }
    />
  );
}
