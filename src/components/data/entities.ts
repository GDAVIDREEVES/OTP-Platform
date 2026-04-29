/**
 * Entity types & UI constants.
 *
 * Mock entity data has been removed — all runtime data now comes from the
 * FastAPI backend via `useEntities()` / `useEntity()` (see `src/data`).
 *
 * Backend contract: `backend/main.py::list_entities`.
 */

export type EntityStatus = 'in-range' | 'watch' | 'out-of-range';

export interface Entity {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  function: string;
  tpRole: string;
  tpMethod: string;
  ytdVolume: number;
  /** Revenue-weighted YTD operating margin (in percent, e.g. -6.29). */
  actualMargin: number | null;
  targetMarginLow: number;
  targetMarginHigh: number;
  targetMarginLabel: string;
  /** Signed pp distance outside the band (0 if inside). */
  variance: number | null;
  status: EntityStatus;
  lastUpdated: string | null;
  lat: number;
  lng: number;

  // ---- backend extensions (optional for backward compat) ----
  /** Latest single-period margin in percent. Useful for monthly monitoring. */
  latestPeriodMargin?: number | null;
  /** YTD operating profit in entity local currency. */
  ytdOpProfit?: number;
  /** ISO currency code of `ytdVolume` / `ytdOpProfit`. */
  currency?: string;
  /** SAP role taxonomy code (IPPR, FRMF, TOLL, LRD, FINC, …). */
  roleCode?: string;
}

export const statusColor: Record<EntityStatus, string> = {
  'in-range': '#16A34A',
  watch: '#D97706',
  'out-of-range': '#DC2626',
};

export const statusLabel: Record<EntityStatus, string> = {
  'in-range': 'In Range',
  watch: 'Watch',
  'out-of-range': 'Out of Range',
};
