import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Items with `hidden: true` are not rendered. */
  hidden?: boolean;
}

interface MenuProps {
  items: MenuItem[];
  trigger?: ReactNode;
  label?: string;
  align?: 'left' | 'right';
  className?: string;
}

/** Dropdown action menu rendered in a portal so table overflow never clips it. */
export function Menu({ items, trigger, label = 'Actions', align = 'right', className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const visible = items.filter((i) => !i.hidden);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const width = 200;
    const left = align === 'right' ? Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) : Math.min(r.left, window.innerWidth - width - 8);
    const estHeight = visible.length * 40 + 8;
    const top = r.bottom + estHeight > window.innerHeight - 8 ? Math.max(8, r.top - estHeight - 4) : r.bottom + 4;
    setPos({ top, left });
  }, [open, align, visible.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof MouseEvent && (panel.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }, [open, pos]);

  if (visible.length === 0) return null;

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cn(!trigger && 'rounded-full p-2 text-neutral-400 transition-colors hover:bg-slate-900/[0.06] hover:text-neutral-900', className)}
      >
        {trigger ?? <MoreVertical className="h-4 w-4" />}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            style={{ top: pos.top, left: pos.left }}
            className="no-print fixed z-[60] w-[208px] animate-pop-in rounded-2xl bg-white/85 p-1.5 shadow-pop ring-1 ring-slate-900/5 backdrop-blur-xl backdrop-saturate-150"
            onKeyDown={(e) => {
              const els = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
              const i = els.indexOf(document.activeElement as HTMLElement);
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                els[(i + 1) % els.length]?.focus();
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                els[(i - 1 + els.length) % els.length]?.focus();
              }
            }}
          >
            {visible.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                type="button"
                disabled={item.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  item.onClick();
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-900/[0.06] disabled:opacity-40 md:py-2',
                  item.danger ? 'text-red-600 hover:bg-red-500/10' : 'text-neutral-800',
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
