/** Calc Studio — shared helpers + data hooks (CS-b).
 *
 * Lifted from the OTP-49 console binding when the console grew into the
 * first-class Calc Studio module: the provenance metadata, the value renderer
 * and the parameter/catalog/provenance fetch hooks are shared by the module
 * tabs AND the thin OTP-49 binding (src/kernel/bindings/marquee/otp49.tsx),
 * so the process view and the module never drift.
 */

import { useEffect, useState } from 'react';
import { api } from '@/shared/api/client';
import type { ProvenanceKind } from '@/kernel/audit/ProvenanceChip';
import type {
  Parameter, CatalogEntry, Provenance, ProvenanceRollup, ShapedStep, TraceStep,
} from '@/shared/api/types';

/** Map the catalog/parameter `provenance` field onto the ProvenanceChip kind. */
export const provKind = (p: Provenance | null | undefined): ProvenanceKind =>
  p === 'real' || p === 'fabricated' ? p : 'assumed';

/** Render a JSON value (scalar | list | dict) compactly for a table cell. */
export function valueText(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export const CATALOG_KINDS: { key: string; label: string }[] = [
  { key: 'warehouse', label: 'Warehouse (DuckDB / parquet)' },
  { key: 'state', label: 'State (SQLite — governed actions)' },
  { key: 'seed', label: 'Reference seeds' },
  { key: 'parameter', label: 'Calc parameters' },
];

export const PROV_META: Record<Provenance, { label: string; hint: string }> = {
  real: { label: 'Real', hint: 'Verifiable warehouse / governed-state figures' },
  assumed: { label: 'Assumed', hint: 'Illustrative reference applied over the real base' },
  fabricated: { label: 'Fabricated', hint: 'Magnitudes invented for the demo' },
};

/** Bucket order for the provenance dashboard — honest inventory first. */
export const PROV_ORDER: Provenance[] = ['fabricated', 'assumed', 'real'];

/** Shape the raw term steps of an expression evaluation (W4 — the Builder's
 *  Preview and user-calc runs, which have no curated shaped_trace) into
 *  TraceTree steps: one card per param/measure/calc term carrying the value
 *  the engine actually read. The warehouse kernel's own "aggregate" step is
 *  folded into its measure. `catalogByTable` (table -> catalog id, from
 *  GET /api/user-calcs/terms or the calc's resolved inputs) attaches the
 *  ProvenanceChip source when known — nothing is invented here. */
export function shapeTermSteps(
  steps: TraceStep[],
  catalogByTable: Record<string, string> = {},
): ShapedStep[] {
  const out: ShapedStep[] = [];
  steps.forEach((s, i) => {
    if (s.step === 'param') {
      const key = String(s.key);
      out.push({
        id: `param-${i}`,
        label: `Parameter ${key}`,
        formula: `param('${key}')`,
        params: [{ key, value: s.value, overridden: Boolean(s.overridden) }],
        values: {},
        sources: [],
      });
    } else if (s.step === 'measure') {
      const ref = String(s.ref);
      const table = ref.split('.')[0];
      const grain = String(s.grain ?? 'group');
      const filters = s.filters == null ? null : String(s.filters);
      out.push({
        id: `measure-${i}`,
        label: `Measure ${ref}`,
        formula: `measure('${ref}', '${grain}'${filters ? `, '${filters}'` : ''})`,
        params: [],
        values: { grain, ...(filters ? { filters } : {}), rows: s.rows },
        sources: catalogByTable[table] ? [catalogByTable[table]] : [],
      });
    } else if (s.step === 'calc') {
      const calcId = String(s.calc_id);
      const outputKey = String(s.output_key);
      out.push({
        id: `calc-${i}`,
        label: `Calculation ${calcId} · ${outputKey}`,
        formula: `calc('${calcId}', '${outputKey}')`,
        params: [],
        values: { value: s.value },
        sources: [],
      });
    }
  });
  return out;
}

// ---- data hooks ----

export function useParameters() {
  const [params, setParams] = useState<Parameter[] | null>(null);
  const refresh = () =>
    api.parameters().then(setParams).catch(() => setParams([]));
  useEffect(() => { void refresh(); }, []);
  return { params, refresh };
}

export function useCatalog() {
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  useEffect(() => {
    api.catalog().then(setEntries).catch(() => setEntries([]));
  }, []);
  return entries;
}

export function useProvenance() {
  const [roll, setRoll] = useState<ProvenanceRollup | null>(null);
  useEffect(() => {
    api.catalogProvenance().then(setRoll).catch(() => setRoll(null));
  }, []);
  return roll;
}
