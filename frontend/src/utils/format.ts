import type { ISODate } from '@/types';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** Rounds to 2 decimals, avoiding binary floating-point drift (e.g. 1.005). */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export const formatCurrency = (n: number | null | undefined): string => (n == null ? '—' : inr.format(n));
/** Compact whole-rupee format for KPI cards and chart axes. */
export const formatCurrencyWhole = (n: number | null | undefined): string => (n == null ? '—' : inrWhole.format(n));
export const formatNumber = (n: number | null | undefined): string => (n == null ? '—' : num.format(n));
export const formatPercent = (n: number | null | undefined, digits = 1): string =>
  n == null ? '—' : `${n.toFixed(digits).replace(/\.0+$/, '')}%`;

/** Compact INR for chart axes: 1.2L, 3.4Cr. */
export function formatCompactINR(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(0)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(d: ISODate | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return `${String(day).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return `${formatDate(isoDate(d))}, ${time}`;
}

/** `2026-10` -> `Oct 2026` */
export function formatMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function formatQty(qty: number, unitCode?: string): string {
  return unitCode ? `${num.format(qty)} ${unitCode}` : num.format(qty);
}

/** `120 Pcs (10 Box)` when the quantity is a whole number of packs, otherwise just the base quantity. */
export function formatPackQty(qty: number, unitCode: string, packSize: number, packCode: string): string {
  if (packSize > 1 && qty > 0 && qty % packSize === 0) return `${num.format(qty)} ${unitCode} (${qty / packSize} ${packCode})`;
  return `${num.format(qty)} ${unitCode}`;
}

export const titleCase = (s: string): string =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/* ---------- date helpers (all local-time, ISO date strings) ---------- */

export function isoDate(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const today = (): ISODate => isoDate(new Date());

function parse(d: ISODate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
}

export function addDays(d: ISODate, days: number): ISODate {
  const dt = parse(d);
  dt.setDate(dt.getDate() + days);
  return isoDate(dt);
}

export function addMonths(d: ISODate, months: number): ISODate {
  const dt = parse(d);
  dt.setMonth(dt.getMonth() + months);
  return isoDate(dt);
}

/** Whole days from `a` to `b` (b - a). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
}

export const monthKey = (d: ISODate): string => d.slice(0, 7);

export function startOfMonth(d: ISODate = today()): ISODate {
  return `${d.slice(0, 7)}-01`;
}

/** Last `n` month keys ending with the month of `d`, oldest first. */
export function lastMonths(n: number, d: ISODate = today()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(addMonths(startOfMonth(d), -i)));
  return out;
}

export const inRange = (d: ISODate, from: ISODate, to: ISODate): boolean => d >= from && d <= to;
