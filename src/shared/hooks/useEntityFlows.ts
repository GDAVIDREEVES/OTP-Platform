import { api } from '@/shared/api/client';
import type { EntityFlow } from '@/shared/api/types';
import { usePeriod, useToast } from '@/shared/providers/DataProvider';
import { useAsync, type AsyncResult } from './useAsync';

/** Fetch the per-entity flow breakdown lazily, when EntityDetail mounts. */
export function useEntityFlows(entityId: string | undefined): AsyncResult<EntityFlow[]> {
  const toast = useToast();
  const period = usePeriod();
  return useAsync<EntityFlow[]>(
    entityId
      ? () =>
          api.entityFlows(entityId, {
            year: period.year,
            periodFrom: period.periodFrom,
            periodTo: period.periodTo,
          })
      : null,
    [entityId, period.year, period.periodFrom, period.periodTo],
    'Loading flow breakdown',
    toast,
  );
}
