import { useCallback, useState } from 'react';
import { api } from '@/shared/api/client';
import type { SubmittedAdjustment } from '@/shared/api/types';
import { useRefetch, useToast } from '@/shared/providers/DataProvider';

interface MutationResult {
  pending: boolean;
  error: Error | null;
}

/** Lifecycle actions on submitted adjustments — approve / reject / export / reverse / delete.
 *  Each method refreshes the bootstrap data so the new state lands in /api/invoices. */
export function useAdjustmentLifecycle(): {
  approve: (id: string, by: string) => Promise<boolean>;
  reject: (id: string, by: string, reason: string) => Promise<boolean>;
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

  const approve = useCallback(
    async (id: string, by: string) => {
      const r = await wrap('Approve', () =>
        api.patchAdjustment(id, { status: 'Approved', approvedBy: by, by }),
      );
      if (r) toast.show(`${id} approved`, 'success');
      return !!r;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const reject = useCallback(
    async (id: string, by: string, reason: string) => {
      const r = await wrap('Reject', () =>
        api.patchAdjustment(id, {
          status: 'Rejected',
          rejectionReason: reason,
          by,
        }),
      );
      if (r) toast.show(`${id} rejected`, 'info');
      return !!r;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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

  return { approve, reject, markExported, reverse, remove, pending, error };
}
