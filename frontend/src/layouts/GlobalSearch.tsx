import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { services } from '@/services';
import { useDebounce } from '@/hooks/useDebounce';
import type { SearchResult } from '@/types';
import { cn } from '@/utils/cn';

/** Header search across products, batches, invoices, suppliers, distributors and transactions. */
export function GlobalSearch({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const term = useDebounce(q, 200);

  useEffect(() => {
    let cancelled = false;
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }
    services.search(term).then((r) => {
      if (!cancelled) {
        setResults(r);
        setActive(0);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [term]);

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const go = (r: SearchResult) => {
    setOpen(false);
    setQ('');
    navigate(r.href);
  };

  return (
    <div ref={box} className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
      <input
        type="search"
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && results[active]) go(results[active]);
          else if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Search products, invoices, distributors…"
        aria-label="Global search"
        role="combobox"
        aria-expanded={open && term.trim().length >= 2}
        aria-controls="global-search-results"
        className="h-10 w-full rounded-full border-0 bg-white/60 pl-10 pr-4 text-sm shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/[0.08] transition-all placeholder:text-neutral-400 hover:bg-white/80 focus:bg-white md:h-10 [&::-webkit-search-cancel-button]:hidden"
      />
      {open && term.trim().length >= 2 && (
        <ul id="global-search-results" role="listbox" className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 animate-pop-in overflow-y-auto rounded-2xl bg-white/90 p-1.5 shadow-pop ring-1 ring-slate-900/5 backdrop-blur-xl md:min-w-[22rem]">
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-neutral-500">No results for “{term}”</li>
          ) : (
            results.map((r, i) => (
              <li key={`${r.type}-${r.href}-${r.label}`} role="option" aria-selected={i === active}>
                <button type="button" onClick={() => go(r)} onMouseEnter={() => setActive(i)} className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left md:py-2', i === active && 'bg-slate-900/[0.06]')}>
                  <span className="w-24 shrink-0 text-[10.5px] font-semibold uppercase tracking-wider text-neutral-400">{r.type}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-neutral-900">{r.label}</span>
                    <span className="block truncate text-xs text-neutral-500">{r.sub}</span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
