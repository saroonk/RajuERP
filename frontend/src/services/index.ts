import { httpServices } from './http';
import { seedDb } from './mock/seed';
import { mockServices } from './mock/services';
import type { Services } from './types';

/** `VITE_USE_MOCK=true` runs the UI against in-memory demo data (tests, offline demos). Otherwise the Django API is used. */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

if (USE_MOCK) seedDb();

/** The single place the UI gets its data from. */
export const services: Services = USE_MOCK ? mockServices : httpServices;

export { ServiceError } from './types';
export type * from './types';

/** Change notifications: pages refetch after every successful mutation. */
export { subscribeToData, getDataVersion, onUnauthorized } from './dataEvents';
