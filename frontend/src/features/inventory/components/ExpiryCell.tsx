import type { ExpiryStatus } from '@/types';
import { cn } from '@/utils/cn';

/** "Expired 12d ago" / "In 20d", colored by urgency. */
export function ExpiryDays({ days, status }: { days: number; status: ExpiryStatus }) {
  const text = days < 0 ? `Expired ${Math.abs(days)}d ago` : days === 0 ? 'Expires today' : `In ${days}d`;
  return <span className={cn('whitespace-nowrap', (status === 'expired' || status === 'critical') && 'font-medium text-red-600', status === 'warning' && 'font-medium text-amber-700')}>{text}</span>;
}
