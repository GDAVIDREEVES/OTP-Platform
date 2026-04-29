import { api } from '@/shared/api/client';
import type { JournalEntryRow } from '@/shared/api/types';
import { useToast } from '@/shared/providers/DataProvider';
import { useAsync, type AsyncResult } from './useAsync';

/** Fetch ACDOCA journal-entry lines for the entity (drill-down). */
export function useJournalEntries(params: {
  entity?: string;
  period?: string;
  year?: number;
  limit?: number;
}): AsyncResult<JournalEntryRow[]> {
  const { entity, period, year, limit } = params;
  const toast = useToast();
  return useAsync<JournalEntryRow[]>(
    entity ? () => api.journalEntries({ entity, period, year, limit }) : null,
    [entity, period, year, limit],
    'Loading journal entries',
    toast,
  );
}
