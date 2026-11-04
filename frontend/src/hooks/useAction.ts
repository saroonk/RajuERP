import { useCallback, useState } from 'react';
import { ServiceError } from '@/services/types';
import { useToast } from '@/components/ui/Toast';

/**
 * Runs a mutation with a busy flag and consistent toasts.
 * `run` resolves to the result, or `undefined` if the service rejected (the error is shown as a toast).
 */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const result = await fn();
        if (success) toast.success(success);
        return result;
      } catch (e) {
        toast.error(e instanceof ServiceError ? e.message : 'Something went wrong. Please try again.');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { run, busy };
}
