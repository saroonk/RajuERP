export const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

export const MODE_VALUES = ['cash', 'bank_transfer', 'upi', 'cheque', 'other'] as const;

export const referenceLabel = (mode: string): string => (mode === 'cheque' ? 'Cheque number' : mode === 'upi' ? 'UPI reference' : mode === 'bank_transfer' ? 'UTR / transaction reference' : 'Reference');
