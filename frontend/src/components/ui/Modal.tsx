import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/utils/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: ReactNode;
  footer?: ReactNode;
  /** Prevent closing via backdrop/Escape (e.g. while saving). */
  locked?: boolean;
}

const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' };

/** Dialog: centered on desktop, near full-screen sheet on phones. */
export function Modal({ open, onClose, title, description, size = 'md', children, footer, locked }: ModalProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // Callers usually pass an inline `onClose`, so its identity changes on every parent render (every keystroke in a form).
  // Keep the latest values in refs so the open/focus effect below runs only when the dialog actually opens or closes.
  const onCloseRef = useRef(onClose);
  const lockedRef = useRef(locked);
  useEffect(() => {
    onCloseRef.current = onClose;
    lockedRef.current = locked;
  });

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      if (panel.current?.contains(document.activeElement) && document.activeElement !== panel.current) return;
      const first = panel.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
      (first ?? panel.current)?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !lockedRef.current) {
        e.stopPropagation();
        onCloseRef.current();
      }
      if (e.key === 'Tab' && panel.current) {
        const f = [...panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 animate-fade-in bg-neutral-950/45 backdrop-blur-md" onClick={() => !locked && onClose()} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn('relative flex max-h-[92dvh] w-full animate-pop-in flex-col rounded-t-3xl bg-white/95 shadow-xl ring-1 ring-white/60 backdrop-blur-xl sm:max-h-[90dvh] sm:rounded-3xl', widths[size])}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-neutral-900">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-xs text-neutral-500">{description}</p>}
          </div>
          <button onClick={onClose} disabled={locked} className="-mr-2 -mt-1 rounded-full p-2 text-neutral-400 transition-colors hover:bg-slate-900/[0.06] hover:text-neutral-900 disabled:opacity-40" aria-label="Close dialog">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/70 px-6 py-4 sm:flex-row sm:justify-end sm:rounded-b-3xl [&>*]:w-full sm:[&>*]:w-auto">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
