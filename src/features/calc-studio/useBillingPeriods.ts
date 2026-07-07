import { useEffect, useMemo, useState } from 'react';
import { api } from '@/shared/api/client';
import type {
  AllocationExclusionRow,
  AllocationRun,
  AllocationSeed,
} from '@/shared/api/types';

/** The engine's billing months, derived from the data (never a hardcoded list):
 *  the Stage-3 exclusion register's effective months ∪ the recorded allocation
 *  runs' periods. Filtered/defaulted to the global point-of-view `year`, with a
 *  graceful fall-back to every month (flagged `diverged`) when the selected year
 *  has no data — so the allocation console and Pool Builder both follow the FY
 *  selector instead of pinning to FY2026 (GP6). */
export interface BillingPeriods {
  /** Every derived billing month, sorted ascending (YYYY-MM). */
  all: string[];
  /** The subset of `all` inside the requested `year`. */
  inYear: string[];
  /** What a period picker should offer: `inYear` when it has months, else `all`. */
  periods: string[];
  /** True when no month matched `year`, so `periods` fell back to `all`. */
  diverged: boolean;
  /** Suggested default selection: latest month within `year`, else latest overall. */
  defaultPeriod: string;
  /** Still loading the underlying seeds/runs. */
  loading: boolean;
}

export function useBillingPeriods(year: number): BillingPeriods {
  const [exclusions, setExclusions] = useState<AllocationExclusionRow[]>([]);
  const [runs, setRuns] = useState<AllocationRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api
        .reference<AllocationSeed<AllocationExclusionRow>>('allocation_exclusions')
        .then((s) => s.rows)
        .catch(() => [] as AllocationExclusionRow[]),
      api.allocationRuns().catch(() => [] as AllocationRun[]),
    ]).then(([ex, rs]) => {
      if (!alive) return;
      setExclusions(ex);
      setRuns(rs);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return useMemo(() => {
    const months = new Set<string>();
    exclusions.forEach((e) => months.add(e.effective_from.slice(0, 7)));
    runs.forEach((r) => {
      if (r.period.length === 7) months.add(r.period);
    });
    const all = [...months].sort();
    const inYear = all.filter((m) => m.slice(0, 4) === String(year));
    const periods = inYear.length ? inYear : all;
    const diverged = inYear.length === 0 && all.length > 0;
    const defaultPeriod = periods.length ? periods[periods.length - 1] : '';
    return { all, inYear, periods, diverged, defaultPeriod, loading };
  }, [exclusions, runs, year, loading]);
}
