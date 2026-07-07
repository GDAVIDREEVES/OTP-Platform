/**
 * WorkSignalsProvider — live "what's on my plate" signals for the shell.
 *
 * Wraps the two read-only aggregators the backend already exposes:
 *  - GET /api/worklist      — the unified worklist (drafts, reviews, exceptions, cases)
 *  - GET /api/close/status  — the ordered 8-step close sequence + active P&L basis
 *
 * Re-fetches on mount, on persona switch (user.id), on fiscal-year change and
 * whenever DataProvider's bootstrap load lands (lastFetchedAt) — so any code
 * already calling `refetch()` transparently invalidates the work signals too.
 * Failures degrade to empty/null (a backend hiccup never crashes the shell).
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from '@/shared/api/client';
import type { CloseBasis, CloseStatus, WorklistItem } from '@/shared/api/types';
import { useLastFetchedAt, usePeriod } from '@/shared/providers/DataProvider';
import { useSessionUser } from '@/shared/providers/SessionProvider';

interface WorkSignalsState {
  worklist: WorklistItem[];
  /** Null until the first fetch lands (or when the backend is unreachable). */
  close: CloseStatus | null;
  /** Re-fetch both signals now (e.g. right after a mutation lands). */
  refresh: () => Promise<void>;
}

const Ctx = createContext<WorkSignalsState | null>(null);

export function WorkSignalsProvider({ children }: { children: React.ReactNode }) {
  const user = useSessionUser();
  const { year } = usePeriod();
  const lastFetchedAt = useLastFetchedAt();
  const [worklist, setWorklist] = useState<WorklistItem[]>([]);
  const [close, setClose] = useState<CloseStatus | null>(null);

  const refresh = useCallback(async () => {
    const [wl, cs] = await Promise.all([
      api.worklist(user.id).catch(() => [] as WorklistItem[]),
      api.closeStatus(user.id, year).catch(() => null),
    ]);
    setWorklist(wl);
    setClose(cs);
  }, [user.id, year]);

  // One fetch effect: mount + persona/year change (via `refresh` identity) +
  // any DataProvider refetch (via `lastFetchedAt`).
  useEffect(() => {
    void refresh();
  }, [refresh, lastFetchedAt]);

  const value = useMemo<WorkSignalsState>(
    () => ({ worklist, close, refresh }),
    [worklist, close, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkSignals(): WorkSignalsState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkSignals must be used within <WorkSignalsProvider>');
  return v;
}

// ----------------- selector hooks -----------------

export const useWorklist = (): WorklistItem[] => useWorkSignals().worklist;
export const useCloseStatus = (): CloseStatus | null => useWorkSignals().close;
export const useBasis = (): CloseBasis | null => useWorkSignals().close?.basis ?? null;
export const useRefreshSignals = () => useWorkSignals().refresh;
