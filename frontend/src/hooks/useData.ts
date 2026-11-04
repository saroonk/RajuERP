import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getDataVersion as getVersion, subscribeToData as subscribe } from '@/services';

export interface DataState<T> {
  data: T | undefined;
  /** True until the first response arrives. Later refetches keep `data` and only set `refreshing`. */
  loading: boolean;
  refreshing: boolean;
  error: Error | undefined;
  reload: () => void;
}

/**
 * Loads data through a service call and refetches whenever any mutation happens anywhere in the app.
 * `deps` lists the values the fetcher closes over (like useEffect deps).
 */
export function useData<T>(fetcher: () => Promise<T>, deps: unknown[] = []): DataState<T> {
  // The version bumps after every mock mutation; with a real API this would be query invalidation.
  const version = useSyncExternalStore(subscribe, getVersion);
  const [state, setState] = useState<{ data: T | undefined; error: Error | undefined; loading: boolean; refreshing: boolean }>({
    data: undefined,
    error: undefined,
    loading: true,
    refreshing: false,
  });
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, refreshing: s.data !== undefined, loading: s.data === undefined, error: undefined }));
    fetcherRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ data, error: undefined, loading: false, refreshing: false });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState((s) => ({ ...s, error: e instanceof Error ? e : new Error(String(e)), loading: false, refreshing: false }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, tick, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
