import { useMemo, useState, type ReactNode } from 'react';
import { useForm, type FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ZodTypeAny } from 'zod';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/Confirm';
import { Modal } from '@/components/ui/Modal';
import { PageHeader, type Crumb } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/data/DataTable';
import { FormFields, type FieldDef } from './FormFields';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import type { CrudService } from '@/services/types';
import type { ModuleKey } from '@/types';
import type { MenuItem } from '@/components/ui/Menu';

interface Props<T extends { id: string }> {
  title: string;
  description?: string;
  breadcrumbs?: Crumb[];
  module: ModuleKey;
  /** Singular noun for dialogs and toasts, e.g. "brand". */
  entityName: string;
  service: CrudService<T, never>;
  columns: Column<T>[];
  fields: FieldDef[];
  schema: ZodTypeAny;
  /** Initial values for a new record. */
  defaults: FieldValues;
  /** Maps a record to form values when editing. Defaults to the record itself. */
  toForm?: (row: T) => FieldValues;
  /** Maps validated form values to the service input. Defaults to identity. */
  toInput?: (values: FieldValues) => unknown;
  nameOf: (row: T) => string;
  searchText?: (row: T) => string;
  filters?: ReactNode;
  /** Page-level filter applied before the table (e.g. by brand). */
  filterFn?: (row: T) => boolean;
  exportName?: string;
  dialogSize?: 'sm' | 'md' | 'lg';
  extraActions?: ReactNode;
  extraRowActions?: (row: T) => MenuItem[];
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  /** Hide delete for rows that must not be removed. */
  canDelete?: (row: T) => boolean;
  emptyDescription?: string;
  /** Render inside another page (e.g. a tab): shows just the Add button instead of a full page header. */
  embedded?: boolean;
}

/**
 * List + create/edit dialog + delete confirmation for a master-data entity.
 * Every master page (brands, products, suppliers, ...) is configured through this component, so they all behave the same.
 */
export function ResourcePage<T extends { id: string }>(p: Props<T>) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const { run, busy } = useAction();
  const list = useData(() => p.service.list());
  const [editing, setEditing] = useState<{ row: T | null } | null>(null);
  const canEdit = can(p.module, 'edit');

  const form = useForm<FieldValues>({ resolver: zodResolver(p.schema), defaultValues: p.defaults });
  const { register, handleSubmit, reset, watch, formState } = form;

  const openCreate = () => {
    reset(p.defaults);
    setEditing({ row: null });
  };
  const openEdit = (row: T) => {
    reset(p.toForm ? p.toForm(row) : (row as unknown as FieldValues));
    setEditing({ row });
  };

  const onSubmit = handleSubmit(async (values) => {
    const input = (p.toInput ? p.toInput(values) : values) as never;
    const row = editing?.row;
    const saved = await run(() => (row ? p.service.update(row.id, input) : p.service.create(input)), row ? `${cap(p.entityName)} updated` : `${cap(p.entityName)} added`);
    if (saved) setEditing(null);
  });

  const remove = async (row: T) => {
    const ok = await confirm({ title: `Delete ${p.entityName}?`, message: `"${p.nameOf(row)}" will be permanently removed. This cannot be undone.`, confirmLabel: 'Delete', danger: true });
    if (ok) await run(() => p.service.remove(row.id), `${cap(p.entityName)} deleted`);
  };

  const rows = useMemo(() => (p.filterFn ? list.data?.filter(p.filterFn) : list.data), [list.data, p.filterFn]);

  return (
    <>
      {(() => {
        const actions = (
          <>
            {p.extraActions}
            {canEdit && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                Add {p.entityName}
              </Button>
            )}
          </>
        );
        return p.embedded ? (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-neutral-500">{p.description}</p>
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          </div>
        ) : (
          <PageHeader title={p.title} description={p.description} breadcrumbs={p.breadcrumbs} actions={actions} />
        );
      })()}
      <DataTable
        data={rows}
        columns={p.columns}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        searchText={p.searchText}
        searchPlaceholder={`Search ${p.entityName}s…`}
        filters={p.filters}
        exportName={p.exportName}
        defaultSort={p.defaultSort}
        emptyTitle={`No ${p.entityName}s yet`}
        emptyDescription={p.emptyDescription ?? (canEdit ? `Add your first ${p.entityName} to get started.` : undefined)}
        emptyAction={canEdit ? <Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Add {p.entityName}</Button> : undefined}
        rowActions={(row) => [
          ...(p.extraRowActions?.(row) ?? []),
          { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onClick: () => openEdit(row), hidden: !canEdit },
          { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onClick: () => remove(row), danger: true, hidden: !canEdit || p.canDelete?.(row) === false },
        ]}
      />
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        locked={busy}
        size={p.dialogSize ?? 'md'}
        title={editing?.row ? `Edit ${p.entityName}` : `Add ${p.entityName}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" form="resource-form" loading={busy}>
              {editing?.row ? 'Save changes' : `Add ${p.entityName}`}
            </Button>
          </>
        }
      >
        <form id="resource-form" onSubmit={onSubmit} noValidate>
          <FormFields fields={p.fields} register={register} errors={formState.errors} watch={watch} />
        </form>
      </Modal>
    </>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
