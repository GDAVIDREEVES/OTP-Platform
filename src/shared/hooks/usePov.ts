import { usePeriod } from '@/shared/providers/DataProvider';
import { periodLabel } from '@/shared/utils/period';
import type { PeriodKey } from '@/shared/types/period';

/** The global point of view — what the AppShell period selector currently
 *  says every read should be scoped to. */
export interface Pov {
  year: number;
  key: PeriodKey;
  /** Human form, e.g. "FY2026 · Full Year". */
  label: string;
}

/** Thin selector over DataProvider's period: the one answer to "which fiscal
 *  year / quarter is this screen supposed to be showing?". Surfaces that pin
 *  themselves to a different year than the selector should say so with
 *  <PovChip pinnedYear={...}>. */
export function usePov(): Pov {
  const period = usePeriod();
  return {
    year: period.year,
    key: period.key,
    label: `FY${period.year} · ${periodLabel(period.key)}`,
  };
}
