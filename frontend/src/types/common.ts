export type ID = string;
/** Calendar date, `YYYY-MM-DD`. */
export type ISODate = string;
/** Full timestamp, ISO 8601. */
export type ISODateTime = string;

export interface Option {
  value: string;
  label: string;
}

/** Where a physical unit of a batch currently sits. Only `saleable` stock can be dispatched. */
export type StockBucket = 'saleable' | 'damaged' | 'expired' | 'inspection';

export type PaymentMode = 'cash' | 'bank_transfer' | 'upi' | 'cheque' | 'other';

export interface DateRange {
  from: ISODate;
  to: ISODate;
}
