import type { ReactNode } from 'react';
import { ResponsiveContainer } from 'recharts';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/States';

/** Chart palette: ink and slate as the foundation, with one blue accent and restrained status colours. */
export const CHART_COLORS = ['#12151c', '#94a3b8', '#3b82f6', '#f59e0b', '#10b981', '#cbd5e1', '#ef4444'];
/** Series colours for charts with many categories (donut / ranked bars): dark to light, then the accent. */
export const CHART_SCALE = ['#12151c', '#2563eb', '#60a5fa', '#64748b', '#94a3b8', '#cbd5e1'];

export const chartAxis = { fontSize: 11, fill: '#64748b' };
export const chartGrid = '#e6eaf2';

interface Props {
  title: string;
  description?: string;
  height?: number;
  action?: ReactNode;
  /** Optional icon in the header (shown in a dark circle). */
  icon?: ReactNode;
  /** When true shows an empty message instead of the chart. */
  empty?: boolean;
  children: React.ReactElement;
}

/** Card with a responsive chart. Recharts fills the card width, so it adapts to phones automatically. */
export function ChartCard({ title, description, height = 260, action, icon, empty, children }: Props) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader title={title} description={description} action={action} icon={icon} divider={false} className="pb-1" />
      <CardBody className="flex-1 px-3 pb-4 pt-2 sm:px-5">
        {empty ? (
          <EmptyState title="No data for this period" />
        ) : (
          <div className="h-full w-full" style={{ minHeight: height }}>
            <ResponsiveContainer width="100%" height="100%" minHeight={height}>
              {children}
            </ResponsiveContainer>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

interface TipEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

interface TipProps {
  active?: boolean;
  payload?: TipEntry[];
  label?: string | number;
  format?: (v: number) => string;
  labelFormat?: (label: string | number, payload: TipEntry[]) => string;
  /** Dot colours by series name, for charts whose fills are gradients. */
  colors?: Record<string, string>;
}

/** Frosted-glass tooltip. Use as `<Tooltip content={<ChartTooltip format={formatCurrency} />} />`. */
export function ChartTooltip({ active, payload, label, format = String, labelFormat, colors }: TipProps) {
  if (!active || !payload?.length) return null;
  const title = label === undefined ? undefined : labelFormat ? labelFormat(label, payload) : label;
  return (
    <div className="min-w-[11rem] rounded-xl bg-white/90 px-3.5 py-3 text-xs shadow-pop ring-1 ring-slate-900/5 backdrop-blur-xl">
      {title !== undefined && title !== '' && <p className="mb-2 font-semibold text-neutral-900">{title}</p>}
      <ul className="space-y-1.5">
        {payload.map((p, i) => (
          <li key={`${p.dataKey ?? p.name}-${i}`} className="flex items-center justify-between gap-5">
            <span className="flex items-center gap-2 text-neutral-600">
              <span className="h-2 w-2 rounded-full" style={{ background: colors?.[String(p.name)] ?? p.color }} />
              {p.name}
            </span>
            <span className="tabular font-semibold text-neutral-900">{format(Number(p.value))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Small legend that sits in a card header or under a chart. */
export function ChartLegend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((i) => (
        <li key={i.name} className="flex items-center gap-1.5 text-xs font-medium text-neutral-600">
          <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: i.color }} />
          {i.name}
        </li>
      ))}
    </ul>
  );
}
