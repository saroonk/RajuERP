import { useId } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ChartTooltip } from './ChartCard';

interface Props {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  /** Formats the value in the hover tooltip. */
  format?: (v: number) => string;
  /** Use light strokes on a dark card. */
  onDark?: boolean;
}

/** Tiny trend line with a soft gradient fill, used under KPI figures. Draws the real monthly series passed in. */
export function Sparkline({ data, color = '#12151c', height = 44, format, onDark }: Props) {
  const id = useId().replace(/:/g, '');
  const stroke = onDark ? '#ffffff' : color;
  return (
    <div style={{ height }} className="-mx-1 w-[calc(100%+0.5rem)]" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={onDark ? 0.35 : 0.22} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip content={<ChartTooltip format={format} />} cursor={{ stroke, strokeOpacity: 0.25, strokeDasharray: '3 3' }} />
          <Area type="monotone" dataKey="value" name="Value" stroke={stroke} strokeWidth={2} fill={`url(#sp-${id})`} dot={false} activeDot={{ r: 3.5, strokeWidth: 2, stroke: onDark ? '#0f121a' : '#fff', fill: stroke }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
