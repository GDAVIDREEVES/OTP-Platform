/**
 * OTP Platform — frontend API client.
 *
 * Thin fetch wrapper over the FastAPI backend. Types here are the contract
 * with `backend/main.py` — keep them in sync.
 *
 * The base URL is overridable via the Vite env var VITE_API_BASE_URL.
 */

import type { Entity, EntityStatus } from '../components/data/entities';
import type {
  TransactionFlow,
  Invoice,
  Royalty,
  MonthlyMarginRow,
} from '../components/data/transactions';

export const API_BASE_URL: string =
  (import.meta as any).env?.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000';

export interface KpiSummary {
  totalICVolume: number;
  entityCount: number;
  entitiesInRange: number;
  entitiesWatch: number;
  entitiesOutOfRange: number;
  openAdjustments: number;
  /** Distinct supply-chain chains under an APA. */
  flowsUnderAPA: number;
  /** Distinct supply-chain chains marked as challenged by a tax authority. */
  flowsChallenged: number;
}

export interface EntityFlow {
  direction: 'sell' | 'buy';
  materialType: string;
  materialLabel: string;
  tpMethod: string;
  ytdVolume: number;
  stepCount: number;
  chains: number;
  apa: boolean;
  challenged: boolean;
  counterparties: string[];
}

export interface BerryRow {
  year: number;
  period: string;
  month: string;
  revenue: number;
  gp: number;
  opex: number;
  berry: number | null;
  target: number;
}

export interface SegmentPnlRow {
  RBUKRS: string;
  ROLE_CODE: string;
  SEGMENT: string;
  GJAHR: number;
  POPER: string;
  revenue: number;
  other_income: number;
  cogs: number;
  opex_production: number;
  opex_rd: number;
  opex_sm: number;
  opex_ga: number;
  opex_dist: number;
  ic_charges: number;
  depreciation: number;
  operating_profit: number;
  operating_margin: number;
}

export interface JournalEntryRow {
  RBUKRS: string;
  GJAHR: number;
  POPER: string;
  BUDAT: string | null;
  BLART: string;
  BELNR: string;
  DOCLN: string;
  RACCT: string;
  RASSC: string;
  MATNR: string;
  WERKS: string;
  HSL: number;
  RHCUR: string;
  SGTXT: string;
}

/**
 * Period filter shared across most read endpoints. The frontend keeps a
 * single instance in DataProvider state; every fetch re-runs when it changes.
 */
export interface PeriodParams {
  year?: number;
  periodFrom?: string; // '001'..'012'
  periodTo?: string;
}

export type AdjustmentStatus =
  | 'Pending Approval'
  | 'Approved'
  | 'Exported'
  | 'Rejected'
  | 'Reversed';

/** Submitted-adjustment record from the write store. */
export interface SubmittedAdjustment {
  id: string;
  entityId: string;
  entityName?: string;
  amount: number;
  currency: string;
  mode: 'median' | 'upper' | 'custom';
  targetMargin: number;
  actualMargin: number;
  notes?: string;
  submittedAt: string;
  submittedBy: string;
  status: AdjustmentStatus;

  // Lifecycle metadata (populated as the record moves through the workflow)
  approvedBy?: string;
  exportedRef?: string;
  rejectionReason?: string;
  updatedAt?: string;
  updatedBy?: string;

  // Reversal pair pointers
  reversesId?: string;     // present on counter-adjustments — points back to original
  reversedById?: string;   // present on originals after reversal — points to counter
  reversedAt?: string;
  reversedBy?: string;
}

/** Per-flow editable override (TP method, reviewer, notes). */
export interface PolicyOverride {
  flowId: string;
  tpMethod?: string;
  reviewer?: string;
  notes?: string;
  updatedAt: string;
  updatedBy?: string;
}

/** App-wide settings stored in the JSON write store. */
export interface AppSettings {
  companyName: string;
  defaultCurrency: string;
  defaultReviewer: string;
  notifyOnDeviation: boolean;
}

// ---------------- low-level fetch helpers ----------------

async function getJSON<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const url = params ? `${path}${qs(params)}` : path;
  const res = await fetch(`${API_BASE_URL}${url}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText} ${body}`);
  }
  return (await res.json()) as T;
}

async function sendJSON<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return (await res.json()) as T;
}

function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

// ---------------- read endpoints ----------------

export const api = {
  health: () =>
    getJSON<{ ok: boolean; data_dir: string; entity_roles_rows: number }>('/api/health'),

  /** Distinct fiscal years present in the data, newest first. */
  years: () => getJSON<number[]>('/api/years'),

  kpis: (period: PeriodParams = {}) =>
    getJSON<KpiSummary>('/api/kpis', period as Record<string, unknown>),

  entities: (period: PeriodParams = {}) =>
    getJSON<Entity[]>('/api/entities', period as Record<string, unknown>),

  entity: (id: string, period: PeriodParams = {}) =>
    getJSON<Entity>(
      `/api/entities/${encodeURIComponent(id)}`,
      period as Record<string, unknown>
    ),

  entityFlows: (id: string, period: PeriodParams = {}) =>
    getJSON<EntityFlow[]>(
      `/api/entities/${encodeURIComponent(id)}/flows`,
      period as Record<string, unknown>
    ),

  berryTrend: (params: { entity?: string; target?: number } & PeriodParams = {}) =>
    getJSON<BerryRow[]>('/api/berry', params as Record<string, unknown>),

  flows: (period: PeriodParams = {}) =>
    getJSON<TransactionFlow[]>('/api/transactions/flows', period as Record<string, unknown>),

  royalties: (period: PeriodParams = {}) =>
    getJSON<Royalty[]>('/api/transactions/royalties', period as Record<string, unknown>),

  invoices: (period: PeriodParams = {}) =>
    getJSON<Invoice[]>('/api/invoices', period as Record<string, unknown>),

  marginTrend: (params: { entityIds?: string[] } & PeriodParams = {}) => {
    const { entityIds, ...rest } = params;
    return getJSON<MonthlyMarginRow[]>('/api/margins/trend', {
      ...rest,
      entities: entityIds && entityIds.length ? entityIds.join(',') : undefined,
    });
  },

  segmentPnl: (
    params: { entity?: string; period?: string; year?: number } = {}
  ) => getJSON<SegmentPnlRow[]>('/api/segments/pl', params),

  journalEntries: (
    params: { entity?: string; period?: string; year?: number; limit?: number } = {}
  ) => getJSON<JournalEntryRow[]>('/api/journal-entries', params),

  // ------------ write endpoints ------------

  submittedAdjustments: () =>
    getJSON<SubmittedAdjustment[]>('/api/adjustments'),

  submitAdjustment: (
    body: Omit<SubmittedAdjustment, 'id' | 'submittedAt' | 'status'>
  ) => sendJSON<SubmittedAdjustment>('POST', '/api/adjustments', body),

  patchAdjustment: (
    id: string,
    body: Partial<{
      status: AdjustmentStatus;
      by: string;
      approvedBy: string;
      exportedRef: string;
      rejectionReason: string;
      notes: string;
    }>
  ) =>
    sendJSON<SubmittedAdjustment>(
      'PATCH',
      `/api/adjustments/${encodeURIComponent(id)}`,
      body
    ),

  deleteAdjustment: (id: string) =>
    sendJSON<{ deleted: string }>(
      'DELETE',
      `/api/adjustments/${encodeURIComponent(id)}`
    ),

  reverseAdjustment: (id: string, body: { by?: string } = {}) =>
    sendJSON<SubmittedAdjustment>(
      'POST',
      `/api/adjustments/${encodeURIComponent(id)}/reverse`,
      body
    ),

  policyOverrides: () =>
    getJSON<Record<string, PolicyOverride>>('/api/overrides/policy'),

  savePolicyOverride: (flowId: string, body: Omit<PolicyOverride, 'flowId' | 'updatedAt'>) =>
    sendJSON<PolicyOverride>(
      'PUT',
      `/api/overrides/policy/${encodeURIComponent(flowId)}`,
      body
    ),

  settings: () => getJSON<AppSettings>('/api/settings'),

  saveSettings: (body: AppSettings) =>
    sendJSON<AppSettings>('PUT', '/api/settings', body),
};

export type { Entity, EntityStatus, TransactionFlow, Invoice, Royalty, MonthlyMarginRow };
