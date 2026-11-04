import { cn } from '@/utils/cn';

interface Tab {
  key: string;
  label: string;
  count?: number;
}

/** Segmented pill control that scrolls horizontally on phones. */
export function Tabs({ tabs, value, onChange, className }: { tabs: Tab[]; value: string; onChange: (key: string) => void; className?: string }) {
  return (
    <div className={cn('scroll-thin -mx-4 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0', className)}>
      <div role="tablist" className="inline-flex gap-1 rounded-2xl bg-slate-900/[0.05] p-1 ring-1 ring-slate-900/[0.04]">
        {tabs.map((t) => {
          const active = t.key === value;
          return (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => onChange(t.key)}
              className={cn(
                'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-200',
                active ? 'bg-white text-neutral-900 shadow-card ring-1 ring-slate-900/5' : 'text-neutral-500 hover:text-neutral-900',
              )}
            >
              {t.label}
              {t.count !== undefined && (
                <span className={cn('tabular rounded-full px-1.5 py-px text-[11px] font-semibold', active ? 'bg-neutral-900 text-white' : 'bg-slate-900/[0.07] text-neutral-600')}>{t.count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
