import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, X } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { findNav, NAV } from '@/app/nav';
import { cn } from '@/utils/cn';

interface Props {
  /** Called after navigating so the mobile drawer can close. */
  onNavigate?: () => void;
  onClose?: () => void;
}

export function Sidebar({ onNavigate, onClose }: Props) {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const activeGroup = findNav(pathname)?.group.label;
  const [open, setOpen] = useState<Record<string, boolean>>(() => (activeGroup ? { [activeGroup]: true } : {}));

  useEffect(() => {
    if (activeGroup) setOpen((o) => (o[activeGroup] ? o : { ...o, [activeGroup]: true }));
  }, [activeGroup]);

  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(i.module)) })).filter((g) => g.items.length > 0);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-b from-[#181c27] via-[#0f121a] to-ink text-neutral-400">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-52 bg-[radial-gradient(120%_100%_at_0%_0%,rgba(99,125,255,0.28),transparent_68%)]" />
      <div className="relative flex h-[72px] shrink-0 items-center justify-between px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-b from-white to-slate-200 text-[15px] font-bold text-neutral-950 shadow-[0_6px_16px_-6px_rgba(255,255,255,0.45)]">R</div>
          <div className="leading-tight">
            <p className="text-[15px] font-semibold tracking-tight text-white">RajuERP</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500">Distribution</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="rounded-md p-2 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white" aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      <nav aria-label="Main" className="scroll-thin relative flex-1 overflow-y-auto px-3 pb-6 pt-1">
        {groups.map((g) => {
          const expanded = !!open[g.label];
          return (
            <div key={g.label} className="mb-1.5">
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [g.label]: !expanded }))}
                aria-expanded={expanded}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-neutral-500 transition-colors hover:text-neutral-300"
              >
                {g.label}
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !expanded && '-rotate-90')} />
              </button>
              {expanded && (
                <ul className="mt-0.5 space-y-0.5">
                  {g.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          cn(
                            'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition-all duration-200 md:py-2',
                            isActive ? 'bg-white font-semibold text-neutral-950 shadow-[0_8px_20px_-8px_rgba(0,0,0,0.7)]' : 'text-neutral-400 hover:bg-white/[0.07] hover:text-neutral-100',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <item.icon className={cn('h-4 w-4 shrink-0 transition-colors', isActive ? 'text-neutral-950' : 'text-neutral-500 group-hover:text-neutral-300')} />
                            <span className="truncate">{item.label}</span>
                          </>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
