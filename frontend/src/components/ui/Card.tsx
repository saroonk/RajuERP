import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/utils/cn';

/** Floating white surface (hairline ring + layered shadow, see `.surface` in index.css). */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('surface', className)}>{children}</section>;
}

interface CardHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Optional icon shown in a dark circle before the title. */
  icon?: ReactNode;
  /** Thin divider under the header. Turn off for airy dashboard panels. */
  divider?: boolean;
  className?: string;
}

export function CardHeader({ title, description, action, icon, divider = true, className }: CardHeaderProps) {
  return (
    <header className={cn('flex items-center justify-between gap-3 px-5 py-4', divider && 'border-b border-slate-100', className)}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white shadow-sm [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold tracking-tight text-neutral-900">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-neutral-500">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

type Tone = 'default' | 'warning' | 'danger' | 'success';
type Variant = 'default' | 'dark' | 'tint';

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  to?: string;
  /** `dark` is the featured card; `tint` softly colours the card by its tone (warnings and alerts). */
  variant?: Variant;
  /** Extra content under the figure, such as a sparkline or a progress bar. */
  footer?: ReactNode;
  /** Stagger the entrance animation (ms). */
  delay?: number;
}

const ICON: Record<Tone, string> = {
  default: 'bg-neutral-900 text-white',
  warning: 'bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/20',
  danger: 'bg-red-500/10 text-red-600 ring-1 ring-red-500/20',
  success: 'bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20',
};
const BAR: Record<Tone, string> = {
  default: 'from-neutral-900 to-accent-500',
  warning: 'from-amber-400 to-amber-600',
  danger: 'from-red-400 to-red-600',
  success: 'from-emerald-400 to-emerald-600',
};
const VALUE: Record<Tone, string> = { default: 'text-neutral-900', warning: 'text-amber-700', danger: 'text-red-600', success: 'text-emerald-700' };
const TINT: Record<Tone, string> = {
  default: 'bg-white',
  warning: 'bg-gradient-to-br from-amber-50 via-white to-white',
  danger: 'bg-gradient-to-br from-red-50 via-white to-white',
  success: 'bg-gradient-to-br from-emerald-50 via-white to-white',
};

/** KPI tile. Pass `to` to make the whole card a link to the underlying list. */
export function StatCard({ label, value, hint, icon, tone = 'default', to, variant = 'default', footer, delay = 0 }: StatCardProps) {
  const dark = variant === 'dark';
  const body = (
    <>
      {dark && <span aria-hidden className="pointer-events-none absolute -right-12 -top-14 h-44 w-44 rounded-full bg-accent-500/30 blur-3xl" />}
      {dark && <span aria-hidden className="pointer-events-none absolute -bottom-16 -left-10 h-36 w-36 rounded-full bg-white/10 blur-3xl" />}
      {!icon && !dark && <span aria-hidden className={cn('relative mb-3 block h-1 w-8 rounded-full bg-gradient-to-r', BAR[tone])} />}
      <div className="relative flex items-start justify-between gap-3">
        <p className={cn('text-[13px] font-medium leading-snug', dark ? 'text-neutral-300' : 'text-neutral-500')}>{label}</p>
        {icon && (
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-sm [&>svg]:h-[18px] [&>svg]:w-[18px]', dark ? 'bg-white/15 text-white ring-1 ring-white/20' : ICON[tone])}>{icon}</span>
        )}
      </div>
      <p className={cn('tabular relative mt-3 truncate font-semibold leading-none tracking-tight [font-size:clamp(1.0625rem,13cqw,2rem)]', dark ? 'text-white' : VALUE[tone])}>{value}</p>
      {hint && <p className={cn('relative mt-2.5 text-xs', dark ? 'text-neutral-400' : 'text-neutral-500')}>{hint}</p>}
      {footer && <div className="relative mt-auto pt-3">{footer}</div>}
    </>
  );
  const style: CSSProperties | undefined = delay ? { animationDelay: `${delay}ms` } : undefined;
  const cls = cn(
    'relative flex animate-rise flex-col overflow-hidden rounded-2xl p-5 ring-1 [container-type:inline-size]',
    dark ? 'bg-gradient-to-br from-neutral-800 via-neutral-900 to-neutral-950 shadow-float ring-white/10' : cn('shadow-card ring-slate-900/[0.05]', variant === 'tint' ? TINT[tone] : 'bg-white'),
  );
  return to ? (
    <Link to={to} style={style} className={cn(cls, 'transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5', dark ? 'hover:shadow-float' : 'hover:shadow-hover')}>
      {body}
    </Link>
  ) : (
    <div style={style} className={cls}>
      {body}
    </div>
  );
}

export function DescriptionList({ items, className }: { items: { label: string; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs font-medium text-neutral-500">{i.label}</dt>
          <dd className="mt-1 break-words text-sm font-medium text-neutral-900">{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
