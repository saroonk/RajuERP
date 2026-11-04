import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/utils/cn';

export function Spinner({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn('flex items-center justify-center gap-2 py-12 text-sm text-neutral-500', className)}>
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
      <div className="mb-4 rounded-full bg-gradient-to-b from-white to-slate-100 p-3.5 text-neutral-400 shadow-card ring-8 ring-slate-100/60">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <p className="text-sm font-medium text-neutral-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-neutral-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error?: Error; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-4 py-14 text-center">
      <div className="mb-4 rounded-full bg-gradient-to-b from-white to-red-50 p-3.5 text-red-500 shadow-card ring-8 ring-red-50/70">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-neutral-900">Could not load this data</p>
      <p className="mt-1 max-w-sm text-xs text-neutral-500">{error?.message ?? 'Something went wrong.'}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Page-level wrapper: shows spinner / error and renders children once `data` exists. */
export function Loadable<T>({ state, children }: { state: { data: T | undefined; loading: boolean; error: Error | undefined; reload: () => void }; children: (data: T) => ReactNode }) {
  if (state.loading) return <Spinner />;
  if (state.error && state.data === undefined) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (state.data === undefined) return <EmptyState title="Not found" description="This record does not exist or was removed." />;
  return <>{children(state.data)}</>;
}
