import { z } from 'zod';
import { today } from './format';
import { GSTIN_REGEX } from './gst';

/** Shared Zod building blocks so validation messages are identical across forms. */
export const requiredText = (label: string, max = 120) =>
  z.string({ required_error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `${label} is too long`);

export const optionalText = (max = 250) => z.string().trim().max(max, 'Too long').default('');

/** Number input registered with `valueAsNumber`: an empty field arrives as NaN. */
export const numberField = (label: string, opts: { min?: number; max?: number; int?: boolean; positive?: boolean } = {}) => {
  let s = z.number({ required_error: `${label} is required`, invalid_type_error: `Enter ${label.toLowerCase()}` });
  if (opts.int) s = s.int(`${label} must be a whole number`);
  if (opts.positive) s = s.gt(0, `${label} must be greater than zero`);
  if (opts.min !== undefined) s = s.min(opts.min, `${label} cannot be less than ${opts.min}`);
  if (opts.max !== undefined) s = s.max(opts.max, `${label} cannot be more than ${opts.max}`);
  return s;
};

export const gstinField = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => v === '' || GSTIN_REGEX.test(v), 'Enter a valid 15-character GSTIN (e.g. 29ABCDE1234F1Z5)');

export const emailField = z.string().trim().email('Enter a valid email address');
export const optionalEmail = z.string().trim().refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email address');
export const phoneField = z.string().trim().refine((v) => v === '' || /^[+\d][\d\s-]{7,15}$/.test(v), 'Enter a valid phone number');
/** `notFuture` for documents that record something that already happened (orders, dispatches, invoices, returns, notes). */
export const dateField = (label: string, opts: { notFuture?: boolean } = {}) =>
  z
    .string({ required_error: `${label} is required` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} is required`)
    .refine((v) => !opts.notFuture || v <= today(), `${label} cannot be in the future`);
