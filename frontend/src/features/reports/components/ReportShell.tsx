import { useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { DateRangeFilter, rangeFor } from '@/components/data/DateRangeFilter';
import { StatCard } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import type { DateRange } from '@/types';

export interface Kpi {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}

/** Period state shared by every report page (defaults to the last six months, matching the filter's first option). */
export function useReportRange(): [DateRange, (r: DateRange) => void] {
  return useState<DateRange>(rangeFor('last_6m'));
}

interface Props {
  title: string;
  description: string;
  range: DateRange;
  onRangeChange: (r: DateRange) => void;
  kpis?: Kpi[];
  /** Explanatory note shown above the data. */
  note?: ReactNode;
  /** Hide the period picker for reports that don't use it. */
  children: ReactNode;
}

/** Common layout for reports: header, period filter, KPI row, note, then the report body. */
export function ReportShell({ title, description, range, onRangeChange, kpis, note, children }: Props) {
  return (
    <>
      <PageHeader title={title} description={description} breadcrumbs={[{ label: 'Reports' }, { label: title }]} />
      <div className="mb-3">
        <DateRangeFilter value={range} onChange={onRangeChange} />
      </div>
      {note && (
        <p className="mb-4 flex items-start gap-2 rounded-xl bg-accent-50/70 p-3.5 text-xs text-neutral-600 ring-1 ring-accent-100">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{note}</span>
        </p>
      )}
      {kpis && kpis.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((k) => (
            <StatCard key={k.label} label={k.label} value={k.value} hint={k.hint} tone={k.tone} />
          ))}
        </div>
      )}
      <div className="space-y-4">{children}</div>
    </>
  );
}

/** Shortens long category labels for chart axes on small screens. */
export const truncate = (s: string, n = 16): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
