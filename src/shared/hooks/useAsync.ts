import { useEffect, useState } from 'react';
import type { ToastApi } from '@/shared/types/toast';

export interface AsyncResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Internal helper for on-demand fetches. Tracks loading/error state, cancels
 * stale requests, and surfaces failures via the shared toast queue.
 */
export function useAsync<T>(
  fetcher: (() => Promise<T>) | null,
  keys: ReadonlyArray<unknown>,
  toastLabel: string,
  toast: ToastApi,
): AsyncResult<T> {
  const [state, setState] = useState<AsyncResult<T>>({
    data: null,
    loading: !!fetcher,
    error: null,
  });
  useEffect(() => {
    if (!fetcher) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setState({ data: null, loading: false, error: err });
        toast.show(`${toastLabel} failed: ${err.message}`, 'error');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, keys);
  return state;
}
