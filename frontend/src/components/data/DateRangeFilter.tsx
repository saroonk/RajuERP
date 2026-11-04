import { useState } from 'react';
import type { DateRange } from '@/types';
import { addDays, addMonths, startOfMonth, today } from '@/utils/format';
import { Input, Select } from '@/components/ui/Inputs';

type Preset = 'this_month' | 'last_month' | 'last_90' | 'last_6m' | 'all' | 'custom';

const FY_START_MONTH = 4; // Indian financial year starts in April

function fyStart(d = today()): string {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return `${m >= FY_START_MONTH ? y : y - 1}-04-01`;
}

export function rangeFor(preset: Exclude<Preset, 'custom'>): DateRange {
  const t = today();
  switch (preset) {
    case 'this_month':
      return { from: startOfMonth(t), to: t };
    case 'last_month': {
      const from = addMonths(startOfMonth(t), -1);
      return { from, to: addDays(startOfMonth(t), -1) };
    }
    case 'last_90':
      return { from: addDays(t, -89), to: t };
    case 'last_6m':
      return { from: addMonths(startOfMonth(t), -5), to: t };
    case 'all':
      return { from: '2000-01-01', to: t };
  }
}

export const defaultRange = (): DateRange => rangeFor('last_6m');

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_90', label: 'Last 90 days' },
  { value: 'last_6m', label: 'Last 6 months' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
];

/** Period picker with quick presets and custom dates. Fully controlled by `{from, to}`. */
export function DateRangeFilter({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const [preset, setPreset] = useState<Preset>('last_6m');
  const invalid = value.from > value.to;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <Select
        aria-label="Period"
        value={preset}
        onChange={(e) => {
          const p = e.target.value as Preset;
          setPreset(p);
          if (p !== 'custom') onChange(rangeFor(p));
        }}
        options={PRESETS}
        className="sm:w-40"
      />
      {preset === 'custom' && (
        <div className="flex items-center gap-2">
          <Input type="date" aria-label="From date" value={value.from} max={value.to} invalid={invalid} onChange={(e) => onChange({ ...value, from: e.target.value })} className="sm:w-36" />
          <span className="text-xs text-neutral-400">to</span>
          <Input type="date" aria-label="To date" value={value.to} min={value.from} invalid={invalid} onChange={(e) => onChange({ ...value, to: e.target.value })} className="sm:w-36" />
        </div>
      )}
      {invalid && <span role="alert" className="text-xs text-red-600">From date must be before To date</span>}
    </div>
  );
}

export { fyStart };
