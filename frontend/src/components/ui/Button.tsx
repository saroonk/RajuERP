import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition-all duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50';
const variants: Record<Variant, string> = {
  primary:
    'bg-gradient-to-b from-[#2b303b] to-ink text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_6px_14px_-6px_rgba(11,13,18,0.65)] hover:-translate-y-px hover:from-[#383e4b] hover:to-[#141821] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_20px_-8px_rgba(11,13,18,0.7)]',
  secondary: 'bg-white text-neutral-800 shadow-sm ring-1 ring-slate-900/10 hover:bg-slate-50 hover:shadow hover:ring-slate-900/20',
  ghost: 'text-neutral-700 hover:bg-slate-900/[0.06]',
  danger:
    'bg-gradient-to-b from-red-500 to-red-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_6px_14px_-6px_rgba(220,38,38,0.6)] hover:-translate-y-px hover:from-red-600 hover:to-red-700',
};
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-xs md:h-8',
  md: 'h-10 px-4 text-sm md:h-9',
};

export const buttonClass = (variant: Variant = 'primary', size: Size = 'md', extra?: string) => cn(base, variants[variant], sizes[size], extra);

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', loading, icon, children, className, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={buttonClass(variant, size, className)} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

interface LinkButtonProps extends LinkProps {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

/** A react-router link that looks like a button. */
export function LinkButton({ variant = 'primary', size = 'md', icon, children, className, ...rest }: LinkButtonProps) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
