/**
 * OTP Platform — frontend API client.
 *
 * Thin fetch wrapper over the FastAPI backend. Types live in `./types.ts`
 * and `@/shared/types/{entity,transaction,period}.ts`.
 *
 * The base URL is overridable via the Vite env var VITE_API_BASE_URL.
 */

import type { Entity } from '@/shared/types/entity';
import type {
  TransactionFlow,
  Invoice,
  Royalty,
  MonthlyMarginRow,
} from '@/shared/types/transaction';
import type { PeriodParams } from '@/shared/types/period';
import type { ProcessCatalog } from '@/kernel/registry/types';
import type {
  KpiSummary,
  EntityFlow,
  BerryRow,
  SegmentPnlRow,
  JournalEntryRow,
  AdjustmentStatus,
  SubmittedAdjustment,
  PolicyOverride,
  AppSettings,
  AuditEvent,
  ChainVerify,
  Draft,
  ReviewItem,
  EvidencePacket,
} from './types';

export const API_BASE_URL: string =
  (import.meta as any).env?.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000';

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

// ---------------- endpoints ----------------

export const api = {
  health: () =>
    getJSON<{ ok: boolean; data_dir: string; entity_roles_rows: number }>('/api/health'),

  /** Distinct fiscal years present in the data, newest first. */
  years: () => getJSON<number[]>('/api/years'),

  /** The OTP-1…50 process catalog + pharmaceutical overlay. */
  processes: () => getJSON<ProcessCatalog>('/api/processes'),

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

  segmentPnl: (params: { entity?: string; period?: string; year?: number } = {}) =>
    getJSON<SegmentPnlRow[]>('/api/segments/pl', params),

  journalEntries: (
    params: { entity?: string; period?: string; year?: number; limit?: number } = {}
  ) => getJSON<JournalEntryRow[]>('/api/journal-entries', params),

  // ------------ write endpoints ------------

  submittedAdjustments: () => getJSON<SubmittedAdjustment[]>('/api/adjustments'),

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

  policyOverrides: () => getJSON<Record<string, PolicyOverride>>('/api/overrides/policy'),

  savePolicyOverride: (
    flowId: string,
    body: Omit<PolicyOverride, 'flowId' | 'updatedAt'>
  ) =>
    sendJSON<PolicyOverride>(
      'PUT',
      `/api/overrides/policy/${encodeURIComponent(flowId)}`,
      body
    ),

  settings: () => getJSON<AppSettings>('/api/settings'),

  saveSettings: (body: AppSettings) => sendJSON<AppSettings>('PUT', '/api/settings', body),

  // ------------ Phase 2: audit / drafts / review / evidence ------------

  audit: (params: { record_ref?: string; process_id?: string } = {}) =>
    getJSON<AuditEvent[]>('/api/audit', params),

  auditVerify: () => getJSON<ChainVerify>('/api/audit/verify'),

  drafts: (userId: string) => getJSON<Draft[]>('/api/drafts', { user_id: userId }),

  draft: (processId: string, recordRef: string, userId: string) =>
    getJSON<Draft>(
      `/api/drafts/${encodeURIComponent(processId)}/${encodeURIComponent(recordRef)}`,
      { user_id: userId }
    ),

  putDraft: (body: {
    user_id: string;
    process_id: string;
    record_ref: string;
    step: string;
    step_index?: number;
    payload?: Record<string, unknown>;
    status?: string;
  }) => sendJSON<Draft>('PUT', '/api/drafts', body),

  deleteDraft: (id: number) => sendJSON<{ deleted: boolean }>('DELETE', `/api/drafts/${id}`),

  reviewQueue: (status: string = 'pending') =>
    getJSON<ReviewItem[]>('/api/review-queue', { status }),

  enqueueReview: (body: { process_id: string; record_ref: string; maker: string }) =>
    sendJSON<ReviewItem>('POST', '/api/review-queue', body),

  approveReview: (id: number, body: { checker: string; comments?: string }) =>
    sendJSON<ReviewItem>('POST', `/api/review/${id}/approve`, body),

  rejectReview: (id: number, body: { checker: string; comments: string }) =>
    sendJSON<ReviewItem>('POST', `/api/review/${id}/reject`, body),

  evidence: (recordRef: string) =>
    getJSON<EvidencePacket>(`/api/evidence/${encodeURIComponent(recordRef)}`),

  /** Read-only reference seed set (benchmarks, intangibles, dempe, cbcr, pillar_two, utp_reserve). */
  reference: <T = unknown>(name: string) => getJSON<T>(`/api/reference/${name}`),

  /** Research Brain agentic "prepare steps" hand-off (logs an assisted event). */
  researchBrainPrepare: (body: {
    process_id: string;
    record_ref: string;
    entity_id?: string;
    gap_pp?: number;
    postings?: number;
    summary?: string;
  }) =>
    sendJSON<{ summary: string; actor: string; event_id: number }>(
      'POST',
      '/api/research-brain/prepare',
      body
    ),
};
