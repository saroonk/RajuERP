import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/utils/cn';

type Tone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (tone: Tone, message: string) => {
      const id = Date.now() + Math.random();
      setItems((l) => [...l.slice(-3), { id, tone, message }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(() => ({ success: (m) => push('success', m), error: (m) => push('error', m), info: (m) => push('info', m) }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-stretch gap-2 p-3 sm:inset-x-auto sm:right-0 sm:top-0 sm:bottom-auto sm:w-96" role="region" aria-label="Notifications">
        {items.map((t) => {
          const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? XCircle : Info;
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className={cn(
                'pointer-events-auto flex animate-pop-in items-start gap-3 rounded-2xl bg-white/90 p-4 shadow-pop ring-1 backdrop-blur-xl',
                t.tone === 'success' && 'ring-emerald-500/25',
                t.tone === 'error' && 'ring-red-500/25',
                t.tone === 'info' && 'ring-slate-900/10',
              )}
            >
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', t.tone === 'success' && 'text-emerald-600', t.tone === 'error' && 'text-red-600', t.tone === 'info' && 'text-neutral-600')} />
              <p className="flex-1 text-sm font-medium text-neutral-800">{t.message}</p>
              <button onClick={() => dismiss(t.id)} className="rounded-full p-1 text-neutral-400 transition-colors hover:bg-slate-900/[0.06] hover:text-neutral-700" aria-label="Dismiss notification">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
