import { useCallback, useState } from 'react';
import { api } from '@/shared/api/client';
import type { PolicyOverride } from '@/shared/api/types';
import { useToast } from '@/shared/providers/DataProvider';

interface MutationResult {
  pending: boolean;
  error: Error | null;
}

/** Save (upsert) a policy override for a flow row. */
export function useSavePolicyOverride(): {
  save: (
    flowId: string,
    body: Omit<PolicyOverride, 'flowId' | 'updatedAt'>,
  ) => Promise<PolicyOverride | null>;
} & MutationResult {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const save = useCallback(
    async (flowId: string, body: Omit<PolicyOverride, 'flowId' | 'updatedAt'>) => {
      setPending(true);
      setError(null);
      try {
        const o = await api.savePolicyOverride(flowId, body);
        toast.show(`Policy override saved for ${flowId}`, 'success');
        return o;
      } catch (e) {
        const err = e as Error;
        setError(err);
        toast.show(`Save failed: ${err.message}`, 'error');
        return null;
      } finally {
        setPending(false);
      }
    },
    [toast],
  );
  return { save, pending, error };
}
