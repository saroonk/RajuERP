import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, ClipboardList, Eye } from 'lucide-react';
import { z } from 'zod';
import type { Column } from '@/components/data/DataTable';
import type { FieldDef } from '@/components/forms/FormFields';
import { ResourcePage } from '@/components/forms/ResourcePage';
import { StatusBadge } from '@/components/ui/Badge';
import { FilterSelect } from '@/components/ui/Inputs';
import { services } from '@/services';
import type { Distributor } from '@/types';
import { formatCurrency } from '@/utils/format';
import { INDIAN_STATES } from '@/utils/gst';
import { gstinField, numberField, optionalEmail, optionalText, phoneField, requiredText } from '@/utils/schemas';

const schema = z.object({
  code: optionalText(20),
  name: requiredText('Name'),
  type: z.enum(['distributor', 'dealer']),
  contactPerson: optionalText(80),
  phone: phoneField,
  email: optionalEmail,
  gstin: gstinField,
  address: optionalText(200),
  city: optionalText(60),
  state: requiredText('State'),
  creditLimit: numberField('Credit limit', { min: 0 }),
  creditDays: numberField('Credit days', { min: 0, max: 365, int: true }),
  paymentTerms: optionalText(200),
  active: z.boolean(),
});

const states = INDIAN_STATES.map((s) => ({ value: s, label: s }));
const types = [{ value: 'distributor', label: 'Distributor' }, { value: 'dealer', label: 'Dealer' }];

const fields: FieldDef[] = [
  { name: 'name', label: 'Name', type: 'text', required: true, wide: true },
  { name: 'code', label: 'Code', type: 'text', hint: 'Leave blank to generate automatically.' },
  { name: 'type', label: 'Type', type: 'select', options: types, required: true },
  { name: 'contactPerson', label: 'Contact person', type: 'text' },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'gstin', label: 'GSTIN', type: 'text', placeholder: '29ABCDE1234F1Z5' },
  { name: 'address', label: 'Address', type: 'text', wide: true },
  { name: 'city', label: 'City', type: 'text' },
  { name: 'state', label: 'State', type: 'select', options: states, required: true, hint: 'Decides CGST+SGST vs IGST on invoices.' },
  { name: 'creditLimit', label: 'Credit limit (₹)', type: 'number', required: true, min: 0 },
  { name: 'creditDays', label: 'Credit days', type: 'number', required: true, min: 0, step: '1' },
  { name: 'paymentTerms', label: 'Payment terms', type: 'text', wide: true },
  { name: 'active', label: 'Active', type: 'checkbox' },
];

export default function DistributorsPage() {
  const navigate = useNavigate();
  const [type, setType] = useState('');
  const [state, setState] = useState('');
  const [status, setStatus] = useState('');
  const filterFn = useCallback(
    (d: Distributor) => (!type || d.type === type) && (!state || d.state === state) && (!status || (status === 'active') === d.active),
    [type, state, status],
  );

  const columns: Column<Distributor>[] = [
    { key: 'code', header: 'Code', value: (r) => r.code },
    { key: 'name', header: 'Name', value: (r) => r.name, cell: (r) => <Link to={`/distribution/distributors/${r.id}`} className="font-medium hover:underline">{r.name}</Link>, primary: true },
    { key: 'type', header: 'Type', value: (r) => r.type, cell: (r) => <StatusBadge status={r.type} /> },
    { key: 'city', header: 'City / state', value: (r) => `${r.city}, ${r.state}` },
    { key: 'gstin', header: 'GSTIN', value: (r) => r.gstin },
    { key: 'limit', header: 'Credit limit', align: 'right', value: (r) => r.creditLimit, cell: (r) => formatCurrency(r.creditLimit) },
    { key: 'days', header: 'Credit days', align: 'right', value: (r) => r.creditDays },
    { key: 'status', header: 'Status', value: (r) => (r.active ? 'active' : 'inactive'), cell: (r) => <StatusBadge status={r.active ? 'active' : 'inactive'} /> },
  ];

  return (
    <ResourcePage<Distributor>
      title="Distributors & dealers"
      description="Customer records with GSTIN, credit limits and commercial terms."
      module="distributors"
      entityName="distributor"
      service={services.distributors}
      columns={columns}
      fields={fields}
      schema={schema}
      defaults={{ code: '', name: '', type: 'distributor', contactPerson: '', phone: '', email: '', gstin: '', address: '', city: '', state: 'Karnataka', creditLimit: 100000, creditDays: 30, paymentTerms: '', active: true }}
      nameOf={(d) => d.name}
      searchText={(d) => `${d.code} ${d.name} ${d.gstin} ${d.city} ${d.contactPerson} ${d.phone}`}
      exportName="distributors"
      dialogSize="lg"
      filterFn={filterFn}
      defaultSort={{ key: 'name', dir: 'asc' }}
      extraRowActions={(d) => [
        { label: 'View profile', icon: <Eye className="h-4 w-4" />, onClick: () => navigate(`/distribution/distributors/${d.id}`) },
        { label: 'Ledger', icon: <BookOpen className="h-4 w-4" />, onClick: () => navigate(`/accounts/ledger/${d.id}`) },
        { label: 'New order', icon: <ClipboardList className="h-4 w-4" />, onClick: () => navigate(`/distribution/orders/new?distributor=${d.id}`), hidden: !d.active },
      ]}
      filters={
        <>
          <FilterSelect value={type} onChange={setType} options={types} allLabel="All types" />
          <FilterSelect value={state} onChange={setState} options={states} allLabel="All states" />
          <FilterSelect value={status} onChange={setStatus} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} allLabel="All statuses" />
        </>
      }
    />
  );
}
