/**
 * Pure data + helpers backing the DetailedPnL grid.
 * No React; safely importable from any layer.
 */

import type { Entity } from '@/shared/types/entity';

export type Scope = 'country' | 'entity' | 'function';

export interface Account {
  id: string;
  label: string;
  section: 'revenue' | 'cogs' | 'opex' | 'tax';
  indent?: number;
}

export const accounts: Account[] = [
  { id: 'rev_external', label: 'External revenue (third-party)', section: 'revenue' },
  { id: 'rev_ic', label: 'Intercompany revenue', section: 'revenue' },
  { id: 'cogs_materials', label: 'Direct materials', section: 'cogs' },
  { id: 'cogs_labor', label: 'Direct labor', section: 'cogs' },
  { id: 'cogs_mfg_oh', label: 'Manufacturing overhead', section: 'cogs' },
  { id: 'cogs_freight', label: 'Freight & logistics', section: 'cogs' },
  { id: 'cogs_royalty', label: 'Royalties & license fees paid', section: 'cogs' },
  { id: 'opex_personnel', label: 'Personnel & benefits', section: 'opex' },
  { id: 'opex_facilities', label: 'Facilities & utilities', section: 'opex' },
  { id: 'opex_it', label: 'IT & software', section: 'opex' },
  { id: 'opex_marketing', label: 'Marketing & advertising', section: 'opex' },
  { id: 'opex_ga', label: 'General & administrative', section: 'opex' },
  { id: 'opex_mgmt_fee', label: 'Management / concept fees paid', section: 'opex' },
  { id: 'tax_expense', label: 'Income tax expense', section: 'tax' },
];

export type Matrix = Record<string, Record<string, number>>;

export interface ColumnDef {
  id: string;
  label: string;
  sublabel: string;
  country?: string;
  countryCode?: string;
  functionName?: string;
  entityCount?: number;
  revenue: number;
  opMargin: number;
  entities: Entity[];
  // For function scope — which entity this function-column belongs to
  entityId?: string;
  entityName?: string;
}

export const countryNames: Record<string, string> = {
  US: 'United States',
  GB: 'United Kingdom',
  CH: 'Switzerland',
  IE: 'Ireland',
  CA: 'Canada',
  MX: 'Mexico',
};

export const countryOrder = ['US', 'GB', 'CH', 'IE', 'CA', 'MX'];

/** Parse entity.function (e.g., "R&D / Contract R&D") into an array of functions */
export function parseFunctions(fn: string): string[] {
  return fn.split(/\s*\/\s*/).filter(Boolean);
}

/** Compact currency formatter ($1.2M / $345K). */
export function fmt(n: number) {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function buildInitialMatrix(
  cols: { id: string; revenue: number; opMargin: number }[],
): Matrix {
  const m: Matrix = {};
  cols.forEach((c) => {
    const row: Record<string, number> = {};
    const icRev = c.revenue;
    const externalRev = Math.round(
      icRev * (1.4 + (hash(c.id + 'ext') % 60) / 100),
    );
    const totalRev = externalRev + icRev;
    const opProfit = Math.round(totalRev * (c.opMargin / 100));
    const grossProfitTarget = Math.round(
      totalRev * Math.max(0.18, c.opMargin / 100 + 0.14),
    );
    const totalCogs = totalRev - grossProfitTarget;
    const totalOpex = grossProfitTarget - opProfit;
    const cogsSplit = [0.42, 0.22, 0.16, 0.12, 0.08];
    row['rev_external'] = externalRev;
    row['rev_ic'] = icRev;
    row['cogs_materials'] = Math.round(totalCogs * cogsSplit[0]);
    row['cogs_labor'] = Math.round(totalCogs * cogsSplit[1]);
    row['cogs_mfg_oh'] = Math.round(totalCogs * cogsSplit[2]);
    row['cogs_freight'] = Math.round(totalCogs * cogsSplit[3]);
    row['cogs_royalty'] = Math.round(totalCogs * cogsSplit[4]);
    const opexSplit = [0.38, 0.12, 0.14, 0.14, 0.14, 0.08];
    row['opex_personnel'] = Math.max(0, Math.round(totalOpex * opexSplit[0]));
    row['opex_facilities'] = Math.max(0, Math.round(totalOpex * opexSplit[1]));
    row['opex_it'] = Math.max(0, Math.round(totalOpex * opexSplit[2]));
    row['opex_marketing'] = Math.max(0, Math.round(totalOpex * opexSplit[3]));
    row['opex_ga'] = Math.max(0, Math.round(totalOpex * opexSplit[4]));
    row['opex_mgmt_fee'] = Math.max(0, Math.round(totalOpex * opexSplit[5]));
    row['tax_expense'] = Math.max(0, Math.round(opProfit * 0.24));
    m[c.id] = row;
  });
  return m;
}

export interface CountryBand {
  start: number;
  span: number;
  label: string;
}

export interface EntityBand {
  start: number;
  span: number;
  entityId: string;
  entityName: string;
}

export function buildCountryBands(cols: ColumnDef[]): CountryBand[] {
  const bands: CountryBand[] = [];
  let i = 0;
  while (i < cols.length) {
    const cc = cols[i].countryCode!;
    let j = i;
    while (j < cols.length && cols[j].countryCode === cc) j++;
    bands.push({ start: i, span: j - i, label: countryNames[cc] || cc });
    i = j;
  }
  return bands;
}

export function buildEntityBands(cols: ColumnDef[]): EntityBand[] {
  const bands: EntityBand[] = [];
  let i = 0;
  while (i < cols.length) {
    const eid = cols[i].entityId!;
    let j = i;
    while (j < cols.length && cols[j].entityId === eid) j++;
    bands.push({
      start: i,
      span: j - i,
      entityId: eid,
      entityName: cols[i].entityName || '',
    });
    i = j;
  }
  return bands;
}
