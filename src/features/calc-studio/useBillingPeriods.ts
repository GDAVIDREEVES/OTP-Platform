import { useMemo } from 'react';

/** The engine's billing months, derived from the data (never a hardcoded list):
 *  the Stage-3 exclusion register's effective months ∪ the recorded allocation
 *  runs' periods, filtered to the global point-of-view `year`. When the selected
 *  year has no data it falls back to every month, so the console still works and
 *  a PovChip pinnedYear surfaces the pinned≠global divergence (GP6).
 *
 *  Pure derivation — the caller supplies the already-loaded seeds/runs so the
 *  months are computed, never re-fetched (derive, don't refetch). */
export interface BillingPeriods {
  /** What a period picker should offer: months inside `year`, else every month. */
  periods: string[];
  /** Suggested default: the latest offered month (latest in year, else latest overall). */
  defaultPeriod: string;
}

export function useBillingPeriods(
  year: number,
  exclusions: { effective_from: string }[],
  runs: { period: string }[] | null,
): BillingPeriods {
  return useMemo(() => {
    const months = new Set<string>();
    exclusions.forEach((e) => months.add(e.effective_from.slice(0, 7)));
    (runs ?? []).forEach((r) => {
      if (r.period.length === 7) months.add(r.period);
    });
    const all = [...months].sort();
    const inYear = all.filter((m) => m.slice(0, 4) === String(year));
    const periods = inYear.length ? inYear : all;
    const defaultPeriod = periods.length ? periods[periods.length - 1] : '';
    return { periods, defaultPeriod };
  }, [exclusions, runs, year]);
}
