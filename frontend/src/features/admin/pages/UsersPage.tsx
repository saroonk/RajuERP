import { useState } from 'react';
import { z } from 'zod';
import { ResourcePage } from '@/components/forms/ResourcePage';
import type { FieldDef } from '@/components/forms/FormFields';
import { StatusBadge } from '@/components/ui/Badge';
import { FilterSelect } from '@/components/ui/Inputs';
import type { Column } from '@/components/data/DataTable';
import { services } from '@/services';
import type { User } from '@/types';
import { formatDateTime } from '@/utils/format';
import { emailField, requiredText } from '@/utils/schemas';
import { ROLES, ROLE_LABELS } from '../constants';

const schema = z.object({
  name: requiredText('Name', 80),
  email: emailField,
  role: z.enum(['admin', 'accounts', 'warehouse', 'sales'], { required_error: 'Select a role' }),
  active: z.boolean(),
  password: z.string().optional(),
});

const fields: FieldDef[] = [
  { name: 'name', label: 'Full name', type: 'text', required: true },
  { name: 'email', label: 'Email', type: 'email', required: true },
  { name: 'role', label: 'Role', type: 'select', required: true, options: ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })), hint: 'Role access is configured under Roles & permissions' },
  { name: 'password', label: 'Password', type: 'password', hint: 'Required for new users (min. 8 characters). Leave blank when editing to keep the current password.' },
  { name: 'active', label: 'Active (can sign in)', type: 'checkbox' },
];

const columns: Column<User>[] = [
  { key: 'name', header: 'Name', value: (u) => u.name, primary: true, cell: (u) => <span className="font-medium text-neutral-900">{u.name}</span> },
  { key: 'email', header: 'Email', value: (u) => u.email },
  { key: 'role', header: 'Role', value: (u) => ROLE_LABELS[u.role], cell: (u) => <StatusBadge status={u.role === 'admin' ? 'admin' : 'neutral'} label={ROLE_LABELS[u.role]} /> },
  { key: 'status', header: 'Status', value: (u) => (u.active ? 'Active' : 'Inactive'), cell: (u) => <StatusBadge status={u.active ? 'active' : 'inactive'} /> },
  { key: 'login', header: 'Last sign-in', value: (u) => u.lastLogin, cell: (u) => (u.lastLogin ? formatDateTime(u.lastLogin) : 'Never') },
];

export default function UsersPage() {
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  return (
    <ResourcePage<User>
      title="Users"
      description="Administrators, accounts staff, warehouse staff and other authorised users."
      breadcrumbs={[{ label: 'Administration' }, { label: 'Users' }]}
      module="admin"
      entityName="user"
      service={services.admin.users}
      columns={columns}
      fields={fields}
      schema={schema}
      defaults={{ name: '', email: '', role: 'sales', active: true, password: '' }}
      toInput={({ password, ...rest }) => (password ? { ...rest, password } : rest)}
      nameOf={(u) => u.name}
      searchText={(u) => `${u.name} ${u.email}`}
      exportName="users"
      dialogSize="sm"
      defaultSort={{ key: 'name', dir: 'asc' }}
      filterFn={(u) => (!role || u.role === role) && (!status || (status === 'active') === u.active)}
      filters={
        <>
          <FilterSelect value={role} onChange={setRole} allLabel="All roles" options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
          <FilterSelect value={status} onChange={setStatus} allLabel="All statuses" options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
        </>
      }
    />
  );
}
