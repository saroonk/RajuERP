import { cloneElement, forwardRef, isValidElement, useId, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { Option } from '@/types';

const control =
  'block w-full rounded-xl border bg-white px-3.5 text-sm text-neutral-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-150 placeholder:text-neutral-400 disabled:bg-slate-50 disabled:text-neutral-500 disabled:shadow-none h-10 md:h-9';
const border = (invalid?: boolean) => (invalid ? 'border-red-400 focus-visible:ring-red-500/15' : 'border-slate-200 hover:border-slate-300');

interface WithInvalid {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & WithInvalid>(function Input({ invalid, className, ...rest }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(control, border(invalid), className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & WithInvalid & { options?: Option[]; placeholder?: string }>(function Select(
  { invalid, className, options, placeholder, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} aria-invalid={invalid || undefined} className={cn(control, border(invalid), 'pr-8', className)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options?.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & WithInvalid>(function Textarea({ invalid, className, ...rest }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} rows={3} className={cn(control, border(invalid), 'h-auto py-2', className)} {...rest} />;
});

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string }>(function Checkbox({ label, className, ...rest }, ref) {
  return (
    <label className={cn('flex min-h-10 cursor-pointer items-center gap-2 text-sm text-neutral-800 md:min-h-9', className)}>
      <input ref={ref} type="checkbox" className="h-4 w-4 rounded border-neutral-300 accent-neutral-900" {...rest} />
      {label}
    </label>
  );
});

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** Label + control + error. The child control receives the id and aria attributes automatically. */
export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { id, 'aria-describedby': describedBy, invalid: !!error })
    : children;
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-neutral-700">
        {label}
        {required && <span className="ml-0.5 text-red-500" aria-hidden>*</span>}
      </label>
      {control}
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-neutral-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  label?: string;
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className, label = 'Search' }: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(control, border(), 'rounded-full pl-10 pr-9 [&::-webkit-search-cancel-button]:hidden')}
      />
      {value && (
        <button type="button" onClick={() => onChange('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label="Clear search">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

interface FilterSelectProps {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  /** Label of the "no filter" option, e.g. "All brands". */
  allLabel: string;
  label?: string;
  className?: string;
}

/** Compact select used in table toolbars. The empty value means "no filter". */
export function FilterSelect({ value, onChange, options, allLabel, label, className }: FilterSelectProps) {
  return (
    <select
      aria-label={label ?? allLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(control, border(), 'pr-8 sm:w-auto sm:min-w-[9rem]', value && 'border-neutral-900', className)}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
