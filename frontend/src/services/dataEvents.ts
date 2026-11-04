/**
 * Change notification shared by the mock and HTTP implementations. Pages refetch (see hooks/useData) whenever
 * the version bumps, which happens after every successful mutation. `onUnauthorized` lets the HTTP client tell
 * the auth layer that the session has expired.
 */
let version = 0;
const listeners = new Set<() => void>();
const unauthorizedListeners = new Set<() => void>();

export const getDataVersion = (): number => version;

export function subscribeToData(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function bumpData(): void {
  version++;
  listeners.forEach((l) => l());
}

export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export function emitUnauthorized(): void {
  unauthorizedListeners.forEach((l) => l());
}
