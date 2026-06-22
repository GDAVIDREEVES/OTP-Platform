import type { ExprResult, CockpitNodeValue } from '@/shared/api/types';

/** A compact one-line rendering of an evaluated expression result for a node
 *  badge or a dock cell. Scalars show the exact decimal; a grained result shows
 *  its exact total (when numeric) with the grain + row count. Booleans
 *  (compare nodes) show true/false. Exact strings are preferred over the float
 *  mirror so floats never leak into what the user reads. */
export function resultText(result: ExprResult | undefined): string {
  if (!result) return '—';
  if (result.rows) {
    const total = result.total_exact;
    return total != null
      ? `${total}  (${result.grain}, ${result.rows.length} rows)`
      : `${result.rows.length} rows @ ${result.grain}`;
  }
  if (result.value_exact != null) return result.value_exact;
  if (typeof result.value === 'boolean') return result.value ? 'true' : 'false';
  if (result.value === null || result.value === undefined) return '—';
  return String(result.value);
}

/** The text to paint on a node from a preview pass, or null when the node has
 *  no value (an output node, or a node whose subgraph failed). */
export function nodeValueText(nv: CockpitNodeValue | undefined): string | null {
  if (!nv) return null;
  if (!nv.ok) return null;
  return resultText(nv.result);
}

/** The numeric delta (scenario − base) for a node when BOTH passes produced a
 *  comparable exact scalar/total; null when either is missing or non-scalar.
 *  Decimal strings are subtracted via Number ONLY for the displayed Δ badge —
 *  never fed back into the engine (the engine math stays Decimal server-side). */
export function nodeDelta(
  base: CockpitNodeValue | undefined,
  scen: CockpitNodeValue | undefined
): number | null {
  const b = scalarExact(base);
  const s = scalarExact(scen);
  if (b == null || s == null) return null;
  return s - b;
}

function scalarExact(nv: CockpitNodeValue | undefined): number | null {
  if (!nv || !nv.ok || !nv.result) return null;
  const r = nv.result;
  const exact = r.value_exact ?? r.total_exact;
  if (exact == null) return null;
  const n = Number(exact);
  return Number.isFinite(n) ? n : null;
}

/** Format a Δ for display (sign + locale grouping; the underlying values are
 *  still exact server-side). */
export function deltaText(delta: number | null): string | null {
  if (delta == null) return null;
  if (delta === 0) return '±0';
  const sign = delta > 0 ? '+' : '−';
  const abs = Math.abs(delta);
  const formatted =
    abs >= 1000 ? abs.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(abs);
  return `${sign}${formatted}`;
}
