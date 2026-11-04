import type { FieldErrors, FieldValues, UseFormRegister, UseFormWatch } from 'react-hook-form';
import type { Option } from '@/types';
import { cn } from '@/utils/cn';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Inputs';

export interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'email' | 'tel' | 'password' | 'date' | 'select' | 'textarea' | 'checkbox';
  options?: Option[];
  /** Select/number values are numbers (e.g. GST rate) instead of strings. */
  numeric?: boolean;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  /** Span both columns of the two-column grid. */
  wide?: boolean;
  step?: string;
  min?: number;
  max?: number;
  disabled?: boolean | ((values: FieldValues) => boolean);
  hidden?: (values: FieldValues) => boolean;
  /** Text shown in the empty option of a select. */
  emptyLabel?: string;
}

interface Props {
  fields: FieldDef[];
  register: UseFormRegister<FieldValues>;
  errors: FieldErrors<FieldValues>;
  watch: UseFormWatch<FieldValues>;
}

/** Renders a config-driven form grid bound to react-hook-form. Two columns on tablet and up, one on phones. */
export function FormFields({ fields, register, errors, watch }: Props) {
  const values = watch();
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
      {fields.map((f) => {
        if (f.hidden?.(values)) return null;
        const error = errors[f.name]?.message as string | undefined;
        const disabled = typeof f.disabled === 'function' ? f.disabled(values) : f.disabled;
        const span = cn((f.wide || f.type === 'textarea') && 'sm:col-span-2');
        if (f.type === 'checkbox') {
          return (
            <div key={f.name} className={span}>
              <Checkbox label={f.label} disabled={disabled} {...register(f.name)} />
            </div>
          );
        }
        const reg = register(f.name, { valueAsNumber: f.type === 'number' || (f.type === 'select' && f.numeric) });
        return (
          <Field key={f.name} label={f.label} error={error} hint={f.hint} required={f.required} className={span}>
            {f.type === 'select' ? (
              <Select options={f.options} placeholder={f.emptyLabel ?? (f.required ? 'Select…' : 'None')} disabled={disabled} {...reg} />
            ) : f.type === 'textarea' ? (
              <Textarea placeholder={f.placeholder} disabled={disabled} {...reg} />
            ) : (
              <Input type={f.type} inputMode={f.type === 'number' ? 'decimal' : undefined} step={f.type === 'number' ? (f.step ?? 'any') : undefined} min={f.min} max={f.max} placeholder={f.placeholder} disabled={disabled} {...reg} />
            )}
          </Field>
        );
      })}
    </div>
  );
}
