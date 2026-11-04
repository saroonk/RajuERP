import { useState } from 'react';
import { Info } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Loadable } from '@/components/ui/States';
import { Tabs } from '@/components/ui/Tabs';
import { useAction } from '@/hooks/useAction';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import type { PermissionLevel, Role } from '@/types';
import { cn } from '@/utils/cn';
import { MODULES, MODULE_LABELS, ROLES, ROLE_LABELS } from '../constants';

const LEVELS: { key: PermissionLevel; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'view', label: 'View' },
  { key: 'edit', label: 'Edit' },
];

export default function RolesPage() {
  const perms = useData(() => services.admin.permissions());
  const { run, busy } = useAction();
  const [role, setRole] = useState<Role>('accounts');

  return (
    <>
      <PageHeader title="Roles & permissions" description="Choose what each role can see and change." breadcrumbs={[{ label: 'Administration' }, { label: 'Roles & permissions' }]} />
      <div role="note" className="mb-4 flex gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>These settings control the interface only (menus, pages and action buttons). Real authentication and authorisation must be enforced by the backend. Changes apply immediately to signed-in users.</p>
      </div>
      <Tabs className="mb-4" value={role} onChange={(k) => setRole(k as Role)} tabs={ROLES.map((r) => ({ key: r, label: ROLE_LABELS[r] }))} />
      <Loadable state={perms}>
        {(p) => (
          <Card>
            <ul className="divide-y divide-neutral-100">
              {MODULES.map((m) => {
                const current = p[role][m];
                const locked = role === 'admin' && m === 'admin';
                return (
                  <li key={m} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-neutral-900">{MODULE_LABELS[m]}</p>
                      {locked && <p className="text-xs text-neutral-500">Administrators always keep full access here.</p>}
                    </div>
                    <div role="radiogroup" aria-label={`${ROLE_LABELS[role]} access to ${MODULE_LABELS[m]}`} className="inline-flex self-start rounded-xl bg-slate-900/[0.05] p-1 ring-1 ring-slate-900/[0.04] sm:self-auto">
                      {LEVELS.map((l) => (
                        <button
                          key={l.key}
                          type="button"
                          role="radio"
                          aria-checked={current === l.key}
                          disabled={locked || busy}
                          onClick={() => current !== l.key && run(() => services.admin.setPermission(role, m, l.key), `${ROLE_LABELS[role]}: ${MODULE_LABELS[m]} set to ${l.label.toLowerCase()}`)}
                          className={cn('min-w-16 rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed md:py-1.5', current === l.key ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100', locked && current !== l.key && 'opacity-40')}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </Loadable>
    </>
  );
}
