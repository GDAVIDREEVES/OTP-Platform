import { api } from '@/shared/api/client';
import type { BerryRow } from '@/shared/api/types';
import { usePeriod, useToast } from '@/shared/providers/DataProvider';
import { useAsync, type AsyncResult } from './useAsync';

/** Fetch monthly Berry-ratio trend, with optional entity filter. */
export function useBerryTrend(
  params: { entity?: string; target?: number } = {},
): AsyncResult<BerryRow[]> {
  const { entity, target } = params;
  const toast = useToast();
  const period = usePeriod();
  return useAsync<BerryRow[]>(
    () =>
      api.berryTrend({
        entity,
        target,
        year: period.year,
        periodFrom: period.periodFrom,
        periodTo: period.periodTo,
      }),
    [entity, target, period.year, period.periodFrom, period.periodTo],
    'Loading Berry-ratio trend',
    toast,
  );
}
