import { useCallback, useState } from 'react';
import { api } from '@/shared/api/client';
import type { AppSettings } from '@/shared/api/types';
import { useRefetch, useToast } from '@/shared/providers/DataProvider';

interface MutationResult {
  pending: boolean;
  error: Error | null;
}

/** Save app-wide settings; refreshes the cached settings on success. */
export function useSaveSettings(): {
  save: (body: AppSettings) => Promise<AppSettings | null>;
} & MutationResult {
  const toast = useToast();
  const refetch = useRefetch();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const save = useCallback(
    async (body: AppSettings) => {
      setPending(true);
      setError(null);
      try {
        const s = await api.saveSettings(body);
        toast.show('Settings saved', 'success');
        await refetch();
        return s;
      } catch (e) {
        const err = e as Error;
        setError(err);
        toast.show(`Save failed: ${err.message}`, 'error');
        return null;
      } finally {
        setPending(false);
      }
    },
    [toast, refetch],
  );
  return { save, pending, error };
}
