import { useEffect, useState } from 'react';
import { useForm, type FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ZodTypeAny } from 'zod';
import { z } from 'zod';
import { DatabaseBackup, ShieldCheck } from 'lucide-react';
import { DataTable, type Column } from '@/components/data/DataTable';
import { FormFields, type FieldDef } from '@/components/forms/FormFields';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Loadable } from '@/components/ui/States';
import { Tabs } from '@/components/ui/Tabs';
import { useAuth } from '@/app/AuthContext';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { BackupRecord, Settings } from '@/types';
import { formatDate, formatNumber } from '@/utils/format';
import { INDIAN_STATES } from '@/utils/gst';
import { gstinField, numberField, optionalEmail, optionalText, phoneField, requiredText } from '@/utils/schemas';

const companySchema = z.object({
  companyName: requiredText('Company name'),
  gstin: gstinField,
  state: requiredText('State'),
  address: optionalText(200),
  phone: phoneField,
  email: optionalEmail,
  defaultCreditDays: numberField('Default credit days', { int: true, min: 0, max: 365 }),
  invoiceTerms: optionalText(500),
});
const companyFields: FieldDef[] = [
  { name: 'companyName', label: 'Company name', type: 'text', required: true, wide: true },
  { name: 'gstin', label: 'GSTIN', type: 'text', placeholder: '29ABCDE1234F1Z5' },
  { name: 'state', label: 'State', type: 'select', required: true, options: INDIAN_STATES.map((s) => ({ value: s, label: s })), hint: 'Decides CGST+SGST vs IGST on invoices' },
  { name: 'address', label: 'Address', type: 'textarea' },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'defaultCreditDays', label: 'Default credit days', type: 'number', step: '1', min: 0, required: true },
  { name: 'invoiceTerms', label: 'Invoice terms & conditions', type: 'textarea' },
];

const inventorySchema = z.object({
  valuationMethod: z.enum(['fifo', 'weighted_average']),
  expiryAlertDays: numberField('Expiry alert window', { int: true, min: 1, max: 365 }),
});
const inventoryFields: FieldDef[] = [
  {
    name: 'valuationMethod',
    label: 'Stock valuation method',
    type: 'select',
    required: true,
    options: [
      { value: 'fifo', label: 'FIFO (first-in, first-out)' },
      { value: 'weighted_average', label: 'Weighted average' },
    ],
  },
  { name: 'expiryAlertDays', label: 'Expiry alert window (days)', type: 'number', step: '1', min: 1, max: 365, required: true, hint: 'Batches expiring within this many days raise an alert' },
];

function SettingsForm({ settings, fields, schema, keys, canEdit }: { settings: Settings; fields: FieldDef[]; schema: ZodTypeAny; keys: (keyof Settings)[]; canEdit: boolean }) {
  const { run, busy } = useAction();
  const pick = (s: Settings): FieldValues => Object.fromEntries(keys.map((k) => [k, s[k]]));
  const { register, handleSubmit, reset, watch, formState } = useForm<FieldValues>({ resolver: zodResolver(schema), defaultValues: pick(settings) });
  useEffect(() => {
    reset(pick(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const submit = handleSubmit(async (values) => {
    await run(() => services.admin.updateSettings({ ...settings, ...values } as Settings), 'Settings saved');
  });
  const locked = fields.map((f) => ({ ...f, disabled: !canEdit || f.disabled }));
  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardBody>
          <FormFields fields={locked} register={register} errors={formState.errors} watch={watch} />
        </CardBody>
        {canEdit && (
          <div className="flex justify-end border-t border-neutral-200 bg-neutral-50 px-4 py-3">
            <Button type="submit" loading={busy} disabled={!formState.isDirty}>Save changes</Button>
          </div>
        )}
      </Card>
    </form>
  );
}

function BackupTab({ canEdit }: { canEdit: boolean }) {
  const backups = useData(() => services.admin.backups());
  const { run, busy } = useAction();
  const columns: Column<BackupRecord>[] = [
    { key: 'date', header: 'Date', value: (b) => b.date, primary: true, cell: (b) => `${formatDate(b.date)} ${b.time}` },
    { key: 'type', header: 'Type', value: (b) => b.type, cell: (b) => <StatusBadge status={b.type === 'manual' ? 'info' : 'neutral'} label={b.type === 'manual' ? 'Manual' : 'Scheduled'} /> },
    { key: 'size', header: 'Size', align: 'right', value: (b) => b.sizeMb, cell: (b) => `${formatNumber(b.sizeMb)} MB` },
    { key: 'status', header: 'Status', value: (b) => b.status, cell: (b) => <StatusBadge status={b.status} /> },
  ];
  const checklist: { title: string; text: string; state: string }[] = [
    { title: 'Role-based access', text: 'Menus, pages and actions follow the role permissions set under Roles & permissions.', state: 'In this prototype (UI only)' },
    { title: 'Audit trail', text: 'Important actions and changes are recorded and can be reviewed under Audit trail.', state: 'In this prototype' },
    { title: 'Authentication', text: 'Sign-in here is a mock and provides no real security.', state: 'Backend to implement' },
    { title: 'Database backups', text: 'A scheduled PostgreSQL backup with retention and restore testing.', state: 'Backend to implement' },
    { title: 'Transport security & passwords', text: 'HTTPS everywhere, hashed passwords and a password policy.', state: 'Backend to implement' },
  ];
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Backup history"
          description="Simulated in this prototype: no data is exported. Real database backups are a backend responsibility."
          action={canEdit && <Button icon={<DatabaseBackup className="h-4 w-4" />} loading={busy} onClick={() => run(() => services.admin.runBackup(), 'Simulated backup recorded')}>Run backup now (simulated)</Button>}
        />
        <DataTable data={backups.data} columns={columns} rowKey={(b) => b.id} loading={backups.loading} error={backups.error} onRetry={backups.reload} defaultSort={{ key: 'date', dir: 'desc' }} emptyTitle="No backups recorded" className="rounded-none border-0 shadow-none" />
      </Card>
      <Card>
        <CardHeader title="Security checklist" description="Read-only overview of safeguards and who is responsible for them." />
        <ul className="divide-y divide-neutral-100">
          {checklist.map((c) => (
            <li key={c.title} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
                <div>
                  <p className="text-sm font-medium text-neutral-900">{c.title}</p>
                  <p className="text-xs text-neutral-500">{c.text}</p>
                </div>
              </div>
              <span className="pl-6 text-xs font-medium text-neutral-600 sm:pl-0">{c.state}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  const settings = useData(() => services.admin.settings());
  const canEdit = useAuth().can('admin', 'edit');
  const [tab, setTab] = useState('company');
  return (
    <>
      <PageHeader title="Settings & backup" description="Company profile, billing defaults, inventory rules and backup." breadcrumbs={[{ label: 'Administration' }, { label: 'Settings & backup' }]} />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'company', label: 'Company & billing' },
          { key: 'inventory', label: 'Inventory' },
          { key: 'backup', label: 'Backup & security' },
        ]}
      />
      {tab === 'backup' ? (
        <BackupTab canEdit={canEdit} />
      ) : (
        <Loadable state={settings}>
          {(s) =>
            tab === 'company' ? (
              <SettingsForm key="company" settings={s} fields={companyFields} schema={companySchema} keys={['companyName', 'gstin', 'state', 'address', 'phone', 'email', 'defaultCreditDays', 'invoiceTerms']} canEdit={canEdit} />
            ) : (
              <SettingsForm key="inventory" settings={s} fields={inventoryFields} schema={inventorySchema} keys={['valuationMethod', 'expiryAlertDays']} canEdit={canEdit} />
            )
          }
        </Loadable>
      )}
    </>
  );
}
