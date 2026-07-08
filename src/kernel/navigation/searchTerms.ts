import type { ProcessDef } from '../registry/types';

/** Extra search terms per process (POL-16) — the words a user reaches for that
 *  aren't in the id/name/pattern. Folded into BOTH the command palette and the
 *  process-library search corpus so "true-up", "invoice" or "benchmark" find the
 *  right module. Kept lower-ranked than a literal id/name hit (see searchRank) so
 *  exact matches always win. Lives in this neutral module so the two search
 *  surfaces share one source and can't drift. */
export const SYNONYMS: Record<string, string> = {
  'OTP-4': 'pricing set policy method',
  'OTP-5': 'csa cost sharing arrangement rab pct buy-in platform contribution',
  'OTP-9': 'invoice billing charge intercompany',
  'OTP-10': 'invoice billing service charge allocation cost-to-charge stewardship',
  'OTP-11': 'csa true-up cost sharing',
  'OTP-13': 'invoice billing interest treasury loan',
  'OTP-16': 'true-up year-end adjustment operating margin',
  'OTP-17': 'true-up year-end adjustment credit note',
  'OTP-25': 'benchmark comparables range arm’s-length study refresh',
  'OTP-29': 'dempe intangibles substance functions',
  'OTP-34': 'cbcr country-by-country beps action 13 table 1',
  'OTP-36': 'beat base erosion anti-abuse minimum tax',
  'OTP-39': 'apa advance pricing agreement',
  'OTP-42': 'invoice billing erp reconciliation posting',
  'OTP-43': 'erp reconciliation value break posting divergence',
  'OTP-44': 'profit split residual',
  'OTP-46': 'wht withholding tax treaty',
};

/** Rank a process against a lowercased, NON-EMPTY search needle. Exact OTP-id
 *  match ranks first (0), then an id/name substring (1), then category/pattern
 *  (2), then a synonym hit (3). Returns null when nothing matches so the item
 *  drops out. Callers own the empty-needle case and the sort. Shared by the
 *  command palette and the process-library search so their ranking is one
 *  definition, not two that can drift. */
export function searchRank(def: ProcessDef, needle: string): number | null {
  const id = def.id.toLowerCase();
  const name = def.name.toLowerCase();
  if (id === needle) return 0;
  if (id.includes(needle) || name.includes(needle)) return 1;
  if (`${def.category} ${def.pattern}`.toLowerCase().includes(needle)) return 2;
  if ((SYNONYMS[def.id] ?? '').toLowerCase().includes(needle)) return 3;
  return null;
}
