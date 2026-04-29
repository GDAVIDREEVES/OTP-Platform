import { useState } from 'react';
import { api } from '@/shared/api/client';
import type { SubmittedAdjustment } from '@/shared/api/types';
import { useToast } from '@/shared/providers/DataProvider';
import { useAsync, type AsyncResult } from './useAsync';

/** Fetch the list of submitted adjustments from the write store. */
export function useSubmittedAdjustments(): AsyncResult<SubmittedAdjustment[]> & {
  reload: () => void;
} {
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const result = useAsync<SubmittedAdjustment[]>(
    () => api.submittedAdjustments(),
    [tick],
    'Loading submitted adjustments',
    toast,
  );
  return { ...result, reload: () => setTick((n) => n + 1) };
}
