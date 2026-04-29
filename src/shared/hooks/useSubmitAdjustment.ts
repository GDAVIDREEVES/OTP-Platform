import { useCallback, useState } from 'react';
import { api } from '@/shared/api/client';
import type { SubmittedAdjustment } from '@/shared/api/types';
import { useRefetch, useToast } from '@/shared/providers/DataProvider';

interface MutationResult {
  pending: boolean;
  error: Error | null;
}

/** Submit a new adjustment to the backend store; refresh dashboard data on success. */
export function useSubmitAdjustment(): {
  submit: (
    body: Omit<SubmittedAdjustment, 'id' | 'submittedAt' | 'status'>,
  ) => Promise<SubmittedAdjustment | null>;
} & MutationResult {
  const toast = useToast();
  const refetch = useRefetch();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const submit = useCallback(
    async (body: Omit<SubmittedAdjustment, 'id' | 'submittedAt' | 'status'>) => {
      setPending(true);
      setError(null);
      try {
        const adj = await api.submitAdjustment(body);
        toast.show(`Adjustment ${adj.id} submitted for approval`, 'success');
        await refetch();
        return adj;
      } catch (e) {
        const err = e as Error;
        setError(err);
        toast.show(`Submit failed: ${err.message}`, 'error');
        return null;
      } finally {
        setPending(false);
      }
    },
    [toast, refetch],
  );
  return { submit, pending, error };
}
