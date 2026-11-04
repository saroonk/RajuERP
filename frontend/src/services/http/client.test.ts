import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataVersion, onUnauthorized } from '../dataEvents';
import { ApiError, api, listAll, normalizeIds } from './client';

type FetchArgs = [string, RequestInit | undefined];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let calls: FetchArgs[];
let cookie: string;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    if (url.includes('auth/csrf/')) {
      cookie = 'csrftoken=tok123';
      return json({ csrfToken: 'tok123' });
    }
    return handler(url, init);
  });
}

beforeEach(() => {
  cookie = '';
  vi.stubGlobal('document', {
    get cookie() {
      return cookie;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('normalizeIds', () => {
  it('stringifies id and *Id keys recursively but leaves other numbers alone', () => {
    const out = normalizeIds({ id: 7, productId: 3, qty: 5, supplierId: null, lines: [{ batchId: 9, rate: 1.5 }], productIds: [1, 2] });
    expect(out).toEqual({ id: '7', productId: '3', qty: 5, supplierId: null, lines: [{ batchId: '9', rate: 1.5 }], productIds: ['1', '2'] });
  });
});

describe('request', () => {
  it('fetches the CSRF cookie once and sends it on unsafe methods only', async () => {
    mockFetch(() => json({ id: 1 }));
    await api.get('brands/');
    expect(calls.some(([u]) => u.includes('auth/csrf/'))).toBe(false);
    await api.post('brands/', { name: 'A' });
    await api.patch('brands/1/', { name: 'B' });
    expect(calls.filter(([u]) => u.includes('auth/csrf/'))).toHaveLength(1);
    const post = calls.find(([u, i]) => u.endsWith('/brands/') && i?.method === 'POST')!;
    expect((post[1]!.headers as Record<string, string>)['X-CSRFToken']).toBe('tok123');
    expect(post[1]!.credentials).toBe('include');
    expect(post[1]!.body).toBe(JSON.stringify({ name: 'A' }));
    const get = calls.find(([u]) => u.endsWith('/brands/'))!;
    expect((get[1]!.headers as Record<string, string>)['X-CSRFToken']).toBeUndefined();
  });

  it('maps API error messages and status fallbacks to ApiError', async () => {
    mockFetch((url) => (url.includes('boom') ? json({}, 500) : url.includes('nope') ? json({}, 403) : json({ message: 'Cannot delete "X": it is used by 2 products.' }, 409)));
    await expect(api.delete('brands/1/')).rejects.toMatchObject({ message: 'Cannot delete "X": it is used by 2 products.', status: 409 });
    await expect(api.get('nope/')).rejects.toMatchObject({ message: 'You do not have permission to do this.' });
    await expect(api.get('boom/')).rejects.toMatchObject({ message: 'The server could not be reached or failed. Please try again.' });
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network down');
    });
    const err = await api.get('x/').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toMatch(/could not be reached/);
  });

  it('signals an expired session on 401 except for the auth probes', async () => {
    mockFetch(() => json({ message: 'Authentication credentials were not provided.' }, 401));
    const seen = vi.fn();
    const off = onUnauthorized(seen);
    await api.get('brands/').catch(() => undefined);
    expect(seen).toHaveBeenCalledTimes(1);
    await api.get('auth/me/').catch(() => undefined);
    await api.post('auth/login/', { email: 'a@b.c', password: 'x' }).catch(() => undefined);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it('bumps the data version after successful mutations only', async () => {
    mockFetch(() => json({ ok: true }));
    const v0 = getDataVersion();
    await api.get('brands/');
    expect(getDataVersion()).toBe(v0);
    await api.post('brands/', {});
    expect(getDataVersion()).toBe(v0 + 1);
    mockFetch(() => json({ message: 'no' }, 400));
    await api.post('brands/', {}).catch(() => undefined);
    expect(getDataVersion()).toBe(v0 + 1);
  });
});

describe('listAll', () => {
  it('follows pagination until `next` is null and normalises ids', async () => {
    mockFetch((url) => {
      const page = Number(new URL(url, 'http://x').searchParams.get('page'));
      return json({ count: 3, next: page < 2 ? 'more' : null, previous: null, results: page === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }] });
    });
    const rows = await listAll<{ id: string }>('products/');
    expect(rows.map((r) => r.id)).toEqual(['1', '2', '3']);
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toContain('page_size=1000');
  });

  it('accepts a plain array response', async () => {
    mockFetch(() => json([{ id: 5 }]));
    expect(await listAll('x/')).toEqual([{ id: '5' }]);
  });
});
