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
  Parameter, CatalogEntry, Provenance, ProvenanceRollup,
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
