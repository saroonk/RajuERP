import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Download } from 'lucide-react';
import { cn } from '@/utils/cn';
import { downloadCsv, type CsvValue } from '@/utils/csv';
import { Button } from '@/components/ui/Button';
import { SearchInput } from '@/components/ui/Inputs';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { EmptyState, ErrorState } from '@/components/ui/States';

export interface Column<T> {
  key: string;
  header: string;
  /** Custom rendering. Falls back to `value`. */
  cell?: (row: T) => ReactNode;
  /** Plain value used for sorting, CSV export and as the default cell content. */
  value?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right';
  /** Defaults to true when `value` is provided. */
  sortable?: boolean;
  /** `false` leaves the column out of the CSV; a function overrides the exported value. */
  csv?: boolean | ((row: T) => CsvValue);
  /** Heading of the record card on phones. Defaults to the first column. */
  primary?: boolean;
  hideOnMobile?: boolean;
  className?: string;
}

interface Props<T> {
  /** Already filtered by the page's own filters; search, sorting and paging are handled here. */
  data: T[] | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: Error;
  onRetry?: () => void;
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  filters?: ReactNode;
  toolbarActions?: ReactNode;
  pageSize?: number;
  rowActions?: (row: T) => MenuItem[];
  onRowClick?: (row: T) => void;
  /** Adds an "Export CSV" button that downloads the filtered, sorted rows. */
  exportName?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  /** Rendered under the table, receives all rows after search (not just the current page). */
  summary?: (rows: T[]) => ReactNode;
  className?: string;
}

const PAGE_SIZES = [10, 25, 50];

export function DataTable<T>({
  data,
  columns,
  rowKey,
  loading,
  error,
  onRetry,
  searchText,
  searchPlaceholder,
  filters,
  toolbarActions,
  pageSize: initialPageSize = 10,
  rowActions,
  onRowClick,
  exportName,
  emptyTitle = 'No records yet',
  emptyDescription,
  emptyAction,
  defaultSort,
  summary,
  className,
}: Props<T>) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | undefined>(defaultSort);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const rows = useMemo(() => {
    let out = data ?? [];
    const q = query.trim().toLowerCase();
    if (q && searchText) out = out.filter((r) => searchText(r).toLowerCase().includes(q));
    const col = sort && columns.find((c) => c.key === sort.key);
    if (col?.value) {
      const get = col.value;
      const dir = sort!.dir === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => {
        const x = get(a);
        const y = get(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true })) * dir;
      });
    }
    return out;
  }, [data, query, sort, columns, searchText]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => setPage(1), [query, sort, pageSize, data?.length]);
  const current = Math.min(page, pageCount);
  const visible = rows.slice((current - 1) * pageSize, current * pageSize);

  const toggleSort = (c: Column<T>) => {
    if (!(c.sortable ?? !!c.value)) return;
    setSort((s) => (s?.key === c.key ? (s.dir === 'asc' ? { key: c.key, dir: 'desc' } : undefined) : { key: c.key, dir: 'asc' }));
  };

  const exportCsv = () => {
    const cols = columns.filter((c) => c.csv !== false && (c.value || typeof c.csv === 'function'));
    downloadCsv(
      exportName!,
      cols.map((c) => c.header),
      rows.map((r) => cols.map((c) => (typeof c.csv === 'function' ? c.csv(r) : c.value!(r)))),
    );
  };

  const renderCell = (c: Column<T>, r: T): ReactNode => (c.cell ? c.cell(r) : (c.value?.(r) ?? '—'));
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const secondary = columns.filter((c) => c !== primary && !c.hideOnMobile);
  const hasToolbar = !!(searchText || filters || toolbarActions || exportName);
  const isEmpty = !loading && !error && (data?.length ?? 0) === 0;
  const noMatch = !loading && !error && !isEmpty && rows.length === 0;

  return (
    <div className={cn('surface overflow-hidden', className)}>
      {hasToolbar && (
        <div className="no-print flex flex-col gap-2.5 border-b border-slate-100 p-3.5 md:flex-row md:flex-wrap md:items-center md:px-5">
          {searchText && <SearchInput value={query} onChange={setQuery} placeholder={searchPlaceholder} className="md:w-64" />}
          {filters && <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center [&>*]:w-full sm:[&>*]:w-auto">{filters}</div>}
          <div className="flex flex-wrap items-center gap-2 md:ml-auto">
            {toolbarActions}
            {exportName && (
              <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={exportCsv} disabled={rows.length === 0} className="w-full sm:w-auto">
                Export CSV
              </Button>
            )}
          </div>
        </div>
      )}

      {error && !data ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : loading ? (
        <div className="divide-y divide-neutral-100" aria-busy="true" aria-label="Loading records">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4 px-5 py-4">
              <div className="h-3 w-1/4 animate-pulse rounded bg-neutral-100" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-100" />
              <div className="h-3 w-1/6 animate-pulse rounded bg-neutral-100" />
            </div>
          ))}
        </div>
      ) : isEmpty ? (
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      ) : noMatch ? (
        <EmptyState title="No matching records" description="Try a different search term or clear the filters." />
      ) : (
        <>
          {/* Desktop / tablet table */}
          <div className="relative hidden overflow-x-auto md:block">
            <table className="w-full min-w-max text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                <tr>
                  {columns.map((c) => {
                    const sortable = c.sortable ?? !!c.value;
                    const active = sort?.key === c.key;
                    return (
                      <th key={c.key} scope="col" aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined} className={cn('whitespace-nowrap px-2.5 py-3.5 first:pl-5 xl:px-3.5 xl:first:pl-5', c.align === 'right' && 'text-right', c.className)}>
                        {sortable ? (
                          <button type="button" onClick={() => toggleSort(c)} className={cn('inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-neutral-900', c.align === 'right' && 'flex-row-reverse', active && 'text-neutral-900')}>
                            {c.header}
                            {active ? sort!.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                          </button>
                        ) : (
                          c.header
                        )}
                      </th>
                    );
                  })}
                  {rowActions && <th scope="col" className="sticky right-0 z-[1] w-12 bg-slate-50 px-2 py-3"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/80">
                {visible.map((r) => (
                  <tr
                    key={rowKey(r)}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    className={cn('group transition-colors duration-150 hover:bg-slate-50/90', onRowClick && 'cursor-pointer')}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={cn('px-2.5 py-3.5 align-middle text-neutral-800 first:pl-5 xl:px-3.5 xl:first:pl-5', c.align === 'right' && 'tabular text-right', c.className)}>
                        {renderCell(c, r)}
                      </td>
                    ))}
                    {rowActions && (
                      <td className="sticky right-0 z-[1] bg-white px-2 py-2 text-right shadow-[-10px_0_10px_-10px_rgba(15,23,42,0.16)] transition-colors duration-150 group-hover:bg-slate-50" onClick={(e) => e.stopPropagation()}>
                        <Menu items={rowActions(r)} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone: one card per record */}
          <ul className="divide-y divide-neutral-100 md:hidden">
            {visible.map((r) => (
              <li key={rowKey(r)} className={cn('p-4', onRowClick && 'active:bg-neutral-50')} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-sm font-medium text-neutral-900">{renderCell(primary, r)}</div>
                  {rowActions && (
                    <div onClick={(e) => e.stopPropagation()} className="-mr-2 -mt-1.5">
                      <Menu items={rowActions(r)} />
                    </div>
                  )}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                  {secondary.map((c) => (
                    <div key={c.key} className="min-w-0">
                      <dt className="text-[11px] uppercase tracking-wide text-neutral-400">{c.header}</dt>
                      <dd className="tabular break-words text-sm text-neutral-800">{renderCell(c, r)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>

          {summary && <div className="border-t border-slate-100 bg-slate-50/80 px-5 py-3.5 text-sm">{summary(rows)}</div>}

          <div className="no-print flex flex-col items-center justify-between gap-2 border-t border-slate-100 px-5 py-3.5 text-xs text-neutral-500 sm:flex-row">
            <div className="flex items-center gap-2">
              <span>
                {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, rows.length)} of {rows.length}
              </span>
              <label className="flex items-center gap-1">
                <span className="sr-only">Rows per page</span>
                <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="rounded-full bg-white py-1.5 pl-3 pr-8 text-xs shadow-sm ring-1 ring-slate-900/10">
                  {PAGE_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s} / page
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setPage(current - 1)} disabled={current <= 1} className="rounded-full bg-white p-2 shadow-sm ring-1 ring-slate-900/10 transition-all hover:bg-slate-50 hover:ring-slate-900/20 disabled:opacity-40 disabled:shadow-none md:p-1.5" aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="tabular px-2">
                Page {current} of {pageCount}
              </span>
              <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pageCount} className="rounded-full bg-white p-2 shadow-sm ring-1 ring-slate-900/10 transition-all hover:bg-slate-50 hover:ring-slate-900/20 disabled:opacity-40 disabled:shadow-none md:p-1.5" aria-label="Next page">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
