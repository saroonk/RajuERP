/**
 * Centralized API client. Session-cookie auth + CSRF, JSON in/out, id normalisation, pagination helper and a
 * single error type. It never falls back to fake data: a failed request always surfaces as a ServiceError.
 */
import { bumpData, emitUnauthorized } from '../dataEvents';
import { ServiceError } from '../types';

export class ApiError extends ServiceError {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const rawBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
export const API_BASE = rawBase.replace(/\/+$/, '');

const FALLBACK: Record<number, string> = {
  401: 'Your session has expired. Please sign in again.',
  403: 'You do not have permission to do this.',
  404: 'The requested record was not found.',
};
const SERVER_ERROR = 'The server could not be reached or failed. Please try again.';

export type Params = Record<string, string | number | boolean | null | undefined>;

/** Ids are integers on the wire; the UI uses string ids everywhere, so `id`, `*Id` and `*Ids` become strings. */
export function normalizeIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeIds);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if ((k === 'id' || k.endsWith('Id')) && (typeof v === 'number' || typeof v === 'string')) out[k] = String(v);
      else if (k.endsWith('Ids') && Array.isArray(v)) out[k] = v.map((x) => (typeof x === 'number' ? String(x) : x));
      else out[k] = normalizeIds(v);
    }
    return out;
  }
  return value;
}

export function buildUrl(path: string, params?: Params): string {
  const url = `${API_BASE}/${path.replace(/^\/+/, '')}`;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${url}${url.includes('?') ? '&' : '?'}${s}` : url;
}

function readCsrf(): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

let csrfRequest: Promise<void> | null = null;
async function ensureCsrf(): Promise<void> {
  if (readCsrf()) return;
  csrfRequest ??= fetch(buildUrl('auth/csrf/'), { credentials: 'include' })
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      csrfRequest = null;
    });
  await csrfRequest;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
interface Options {
  params?: Params;
  body?: unknown;
}

/** Auth endpoints answer 401 as part of normal flow, so they must not trigger the "session expired" redirect. */
const isAuthProbe = (path: string) => /^\/?auth\/(login|me|csrf)\/?/.test(path);

export async function request<T>(method: Method, path: string, opts: Options = {}): Promise<T> {
  const unsafe = method !== 'GET';
  if (unsafe) await ensureCsrf();
  const hasBody = opts.body !== undefined;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.params), {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(unsafe ? { 'X-CSRFToken': readCsrf() } : {}),
      },
      body: hasBody ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(SERVER_ERROR, 0);
  }

  if (!res.ok) {
    let message = '';
    try {
      const data = (await res.json()) as { message?: unknown; detail?: unknown };
      message = typeof data.message === 'string' ? data.message : typeof data.detail === 'string' ? data.detail : '';
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401 && !isAuthProbe(path)) emitUnauthorized();
    throw new ApiError(message || FALLBACK[res.status] || (res.status >= 500 ? SERVER_ERROR : 'The request could not be completed.'), res.status);
  }

  if (unsafe) bumpData();
  if (res.status === 204) return undefined as T;
  return normalizeIds(await res.json()) as T;
}

export const api = {
  get: <T>(path: string, params?: Params) => request<T>('GET', path, { params }),
  post: <T>(path: string, body?: unknown, params?: Params) => request<T>('POST', path, { body: body ?? {}, params }),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
  delete: (path: string) => request<void>('DELETE', path),
};

interface Page<T> {
  results: T[];
  next: string | null;
}

/** Plain array or a DRF page, as an array. */
export function asArray<T>(data: T[] | Page<T>): T[] {
  return Array.isArray(data) ? data : data.results;
}

const PAGE_SIZE = 1000;

/** Fetches every page of a paginated list so the existing client-side tables keep working. */
export async function listAll<T>(path: string, params: Params = {}): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page < 1000; page++) {
    const data = await api.get<T[] | Page<T>>(path, { ...params, page_size: PAGE_SIZE, page });
    if (Array.isArray(data)) return data;
    out.push(...data.results);
    if (!data.next) break;
  }
  return out;
}

/** GET a single record; a 404 means "does not exist" (undefined), anything else is an error. */
export async function getOrUndefined<T>(path: string): Promise<T | undefined> {
  try {
    return await api.get<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return undefined;
    throw e;
  }
}
