import { useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/data/DataTable';
import { DateRangeFilter, rangeFor } from '@/components/data/DateRangeFilter';
import { Badge, type Tone } from '@/components/ui/Badge';
import { FilterSelect } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { AuditEntry, DateRange } from '@/types';
import { formatDateTime, titleCase } from '@/utils/format';

const TONES: Record<AuditEntry['action'], Tone> = { create: 'success', update: 'info', delete: 'danger', status: 'warning', login: 'neutral', other: 'neutral' };

export default function AuditPage() {
  const audit = useData(() => services.admin.audit());
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [user, setUser] = useState('');
  const [range, setRange] = useState<DateRange>(rangeFor('all'));

  const entities = useMemo(() => [...new Set((audit.data ?? []).map((a) => a.entityType))].sort(), [audit.data]);
  const users = useMemo(() => [...new Set((audit.data ?? []).map((a) => a.userName))].sort(), [audit.data]);
  const rows = useMemo(
    () => audit.data?.filter((a) => (!entity || a.entityType === entity) && (!action || a.action === action) && (!user || a.userName === user) && a.at.slice(0, 10) >= range.from && a.at.slice(0, 10) <= range.to),
    [audit.data, entity, action, user, range],
  );

  const columns: Column<AuditEntry>[] = [
    { key: 'at', header: 'When', value: (a) => a.at, cell: (a) => formatDateTime(a.at), csv: (a) => a.at },
    { key: 'user', header: 'User', value: (a) => a.userName, primary: true },
    { key: 'action', header: 'Action', value: (a) => a.action, cell: (a) => <Badge tone={TONES[a.action]}>{titleCase(a.action)}</Badge> },
    { key: 'entity', header: 'Record type', value: (a) => a.entityType },
    { key: 'ref', header: 'Reference', value: (a) => a.entityRef },
    { key: 'summary', header: 'Summary', value: (a) => a.summary },
  ];

  return (
    <>
      <PageHeader title="Audit trail" description="Important user actions and changes to transactions and records." breadcrumbs={[{ label: 'Administration' }, { label: 'Audit trail' }]} />
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(a) => a.id}
        loading={audit.loading}
        error={audit.error}
        onRetry={audit.reload}
        searchText={(a) => `${a.userName} ${a.entityType} ${a.entityRef} ${a.summary}`}
        searchPlaceholder="Search the audit trail…"
        exportName="audit-trail"
        pageSize={25}
        emptyTitle="No audit entries"
        filters={
          <>
            <FilterSelect value={entity} onChange={setEntity} allLabel="All record types" options={entities.map((e) => ({ value: e, label: e }))} />
            <FilterSelect value={action} onChange={setAction} allLabel="All actions" options={(Object.keys(TONES) as AuditEntry['action'][]).map((a) => ({ value: a, label: titleCase(a) }))} />
            <FilterSelect value={user} onChange={setUser} allLabel="All users" options={users.map((u) => ({ value: u, label: u }))} />
            <DateRangeFilter value={range} onChange={setRange} />
          </>
        }
      />
    </>
  );
}
