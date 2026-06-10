/** Allocations workbench — display helpers (M7).
 *
 * The allocation engine serves every amount as an EXACT DECIMAL STRING off
 * its append-only ledgers (docs/allocation/ENGINE-CLAUDE.md: no float math on
 * amounts). These helpers keep that discipline in the UI: amounts are
 * formatted lexically (digit grouping on the string), percent display shifts
 * the decimal point on the string, and the only client-side aggregation (the
 * recon KPIs) sums exact cents via BigInt. Nothing here ever parses an amount
 * into an IEEE float.
 */

/** Group an exact decimal string for display ("3522150.00" → "3,522,150.00"). */
export function fmtAmount(s: string | null | undefined): string {
  if (s == null || s === '') return '—';
  let sign = '';
  let v = s;
  if (v.startsWith('-')) {
    sign = '−';
    v = v.slice(1);
  }
  const [int, frac] = v.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + grouped + (frac !== undefined ? `.${frac}` : '');
}

/** Render a decimal-fraction rate/ratio as a percent ("0.0561336…" → "5.6133%",
 *  "1" → "100%") by shifting the decimal point on the STRING — display
 *  truncates to 4 dp; the full-precision rate stays on the row. */
export function fmtPct(s: string | null | undefined): string {
  if (s == null || s === '') return '—';
  let sign = '';
  let v = s;
  if (v.startsWith('-')) {
    sign = '−';
    v = v.slice(1);
  }
  const [i, f = ''] = v.split('.');
  const digits = i + f.padEnd(2, '0'); // ×100 = shift the point two places
  const point = i.length + 2;
  const intPart = digits.slice(0, point).replace(/^0+(?=\d)/, '');
  const fracPart = digits.slice(point, point + 4).replace(/0+$/, '');
  return `${sign}${intPart}${fracPart ? `.${fracPart}` : ''}%`;
}

/** Exact sum of decimal strings via BigInt cents (≤ 2 dp by construction —
 *  the engine quantizes at SPEC §5.6's boundaries). Returns a 2-dp string. */
export function sumCents(values: (string | null | undefined)[]): string {
  let total = 0n;
  for (const v of values) {
    if (v == null || v === '') continue;
    const neg = v.startsWith('-');
    const [i, f = ''] = (neg ? v.slice(1) : v).split('.');
    const cents = BigInt(i + `${f}00`.slice(0, 2));
    total += neg ? -cents : cents;
  }
  const neg = total < 0n;
  const abs = (neg ? -total : total).toString().padStart(3, '0');
  return `${neg ? '-' : ''}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

/** True iff the decimal string is a nonzero amount ("0", "0.00" → false). */
export function isNonZero(s: string | null | undefined): boolean {
  return s != null && /[1-9]/.test(s);
}
