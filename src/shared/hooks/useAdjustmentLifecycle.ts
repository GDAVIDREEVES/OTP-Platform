import { useCallback, useState } from 'react';
import { api } from '@/shared/api/client';
import type { SubmittedAdjustment } from '@/shared/api/types';
import { useRefetch, useToast } from '@/shared/providers/DataProvider';

interface MutationResult {
  pending: boolean;
  error: Error | null;
}

/** Lifecycle actions on submitted adjustments — export / reverse / delete.
 *  Approval is deliberately NOT here: the /review maker-checker queue is the sole
 *  approval door (it promotes the adjustment server-side), so exposing an approve
 *  path from invoicing would bypass segregation of duties.
 *  Each method refreshes the bootstrap data so the new state lands in /api/invoices. */
export function useAdjustmentLifecycle(): {
  markExported: (id: string, ref?: string) => Promise<boolean>;
  reverse: (id: string, by: string) => Promise<SubmittedAdjustment | null>;
  remove: (id: string) => Promise<boolean>;
} & MutationResult {
  const toast = useToast();
  const refetch = useRefetch();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const wrap = async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    setPending(true);
    setError(null);
    try {
      const result = await fn();
      await refetch();
      return result;
    } catch (e) {
      const err = e as Error;
      setError(err);
      toast.show(`${label} failed: ${err.message}`, 'error');
      return null;
    } finally {
      setPending(false);
    }
  };

  const markExported = useCallback(
    async (id: string, ref?: string) => {
      const r = await wrap('Mark exported', () =>
        api.patchAdjustment(id, { status: 'Exported', exportedRef: ref }),
      );
      if (r) toast.show(`${id} marked exported`, 'success');
      return !!r;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const reverse = useCallback(
    async (id: string, by: string) => {
      const counter = await wrap('Reverse', () => api.reverseAdjustment(id, { by }));
      if (counter)
        toast.show(`${id} reversed — counter ${counter.id} created`, 'success');
      return counter;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const remove = useCallback(
    async (id: string) => {
      const r = await wrap('Delete', () => api.deleteAdjustment(id));
      if (r) toast.show(`${id} deleted`, 'success');
      return !!r;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return { markExported, reverse, remove, pending, error };
}
