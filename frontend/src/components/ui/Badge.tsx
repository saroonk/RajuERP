import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { titleCase } from '@/utils/format';

export type Tone = 'neutral' | 'dark' | 'success' | 'warning' | 'danger' | 'info';

const tones: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200/80',
  dark: 'bg-gradient-to-b from-[#2b303b] to-ink text-white ring-ink',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200/70',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200/80',
  danger: 'bg-red-50 text-red-700 ring-red-200/70',
  info: 'bg-blue-50 text-blue-700 ring-blue-200/70',
};

const dots: Record<Tone, string> = {
  neutral: 'bg-neutral-400',
  dark: 'bg-white',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-blue-500',
};

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ring-1 ring-inset', tones[tone], className)}>
      {dot && <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dots[tone])} />}
      {children}
    </span>
  );
}

/** Tone for every status string used in the app, so a status always looks the same everywhere. */
const STATUS_TONE: Record<string, Tone> = {
  // generic
  active: 'success',
  inactive: 'neutral',
  draft: 'neutral',
  cancelled: 'neutral',
  completed: 'success',
  failed: 'danger',
  // purchase / order lifecycle
  ordered: 'info',
  partial: 'warning',
  received: 'success',
  confirmed: 'info',
  partially_dispatched: 'warning',
  dispatched: 'success',
  // invoice payment
  paid: 'success',
  unpaid: 'neutral',
  overdue: 'danger',
  // stock
  ok: 'success',
  low: 'warning',
  out: 'danger',
  expired: 'danger',
  critical: 'danger',
  warning: 'warning',
  saleable: 'success',
  damaged: 'danger',
  inspection: 'warning',
  pending_inspection: 'warning',
  reconciled: 'success',
  approved: 'success',
  // documents / roles
  credit: 'success',
  debit: 'warning',
  own: 'dark',
  external: 'neutral',
  distributor: 'neutral',
  dealer: 'info',
  admin: 'dark',
  // product performance
  high_selling: 'success',
  average: 'neutral',
  slow_moving: 'warning',
  low_performing: 'danger',
};

const STATUS_LABEL: Record<string, string> = {
  out: 'Out of stock',
  low: 'Low stock',
  critical: 'Expires ≤ 30d',
  warning: 'Expiring soon',
  ok: 'OK',
  pending_inspection: 'Pending inspection',
  slow_moving: 'Slow-moving',
  high_selling: 'High-selling',
  low_performing: 'Low-performing',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'} dot>
      {label ?? STATUS_LABEL[status] ?? titleCase(status)}
    </Badge>
  );
}
