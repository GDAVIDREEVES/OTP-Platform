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
  WorklistItem,
  LineageStep,
  EvidencePacket,
  TpFunction,
  MdEntityRow,
  MdTransactionType,
  MdMatrixRow,
  MdStagingItem,
  MdProposal,
  MdOverlayRow,
  MdSimulateResult,
  IntercompanyFlow,
  Case,
  CaseStep,
  CsaModel,
  BeatModel,
  ProfitSplitModel,
  ProfitSplitKey,
  ForecastModel,
  PricingRow,
  Reconciliation,
  DocumentationRollup,
  WhtModel,
  TreasuryModel,
  StewardshipModel,
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

  flowsIntercompany: () => getJSON<IntercompanyFlow[]>('/api/flows/intercompany'),

  royalties: (period: PeriodParams = {}) =>
    getJSON<Royalty[]>('/api/transactions/royalties', period as Record<string, unknown>),

  /** Settable per-material price rows for the goods & services price-setting wizards (OTP-4/1/2). */
  pricing: (period: PeriodParams = {}) =>
    getJSON<PricingRow[]>('/api/transactions/pricing', period as Record<string, unknown>),

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

  /** CSA model (cost pool, RAB shares, PCT buy-ins, true-ups) — computed live from segment_pl. */
  csa: (year?: number) => getJSON<CsaModel>('/api/csa', year ? { year } : {}),

  /** BEAT base-erosion computation (OTP-36) + per-CFC Schedule M rollup (OTP-38).
   *  The US related-party deductible base is live from journal RASSC lines; the
   *  RACCT→payment-type classification is the assumed/fabricated input. */
  beat: (year?: number) => getJSON<BeatModel>('/api/beat', year ? { year } : {}),

  /** Residual profit-split across the non-routine parties (OTP-44 design / OTP-12
   *  calc) — combined operating profit allocated by a selectable key, live from segment_pl. */
  profitSplit: (params: { year?: number; key?: ProfitSplitKey } = {}) =>
    getJSON<ProfitSplitModel>('/api/profit-split', params),

  /** Stewardship cost review (OTP-15) — parent G&A cost base (live from segment_pl)
   *  minus the fabricated shareholder/stewardship candidate lines that are excluded. */
  stewardship: (params: { year?: number } = {}) =>
    getJSON<StewardshipModel>('/api/stewardship', params),

  /** ERP↔TP reconciliation — planned IC price book (supply_chain by AWREF) vs
   *  posted ACDOCA value (journal HSL). Source for OTP-43 recon + OTP-42 billing. */
  reconciliation: (period: PeriodParams = {}) =>
    getJSON<Reconciliation>('/api/reconciliation', period as Record<string, unknown>),

  /** Latest-Estimate forecast per tested party (OTP-24) — derived from segment_pl actuals by run-rate. */
  forecast: (year?: number) => getJSON<ForecastModel>('/api/forecast', year ? { year } : {}),

  journalEntries: (
    params: { entity?: string; period?: string; year?: number; awref?: string; limit?: number } = {}
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

  /** Unified worklist / Inbox — the user's cross-process "what's on my plate"
   *  feed (drafts, review items, OTP-20 exceptions, open cases), overdue-first. */
  worklist: (userId: string) => getJSON<WorklistItem[]>('/api/worklist', { user: userId }),

  evidence: (recordRef: string) =>
    getJSON<EvidencePacket>(`/api/evidence/${encodeURIComponent(recordRef)}`),

  // ------------ cross-process lineage (handoffs / timeline feed) ------------

  /** Record one cross-process handoff against a record_ref (rides the audit chain). */
  recordHandoff: (body: {
    record_ref: string;
    from_process: string;
    to_process: string;
    actor: string;
    summary: string;
  }) => sendJSON('POST', '/api/lineage', body),

  /** The lineage/timeline feed for a record_ref (lifecycle milestones + handoffs). */
  lineage: (ref: string) => getJSON<LineageStep[]>(`/api/lineage/${encodeURIComponent(ref)}`),

  /** Read-only reference seed set (benchmarks, intangibles, dempe, cbcr, pillar_two, utp_reserve). */
  reference: <T = unknown>(name: string) => getJSON<T>(`/api/reference/${name}`),

  /** Per-entity covered-transaction rollup for the documentation workpapers
   *  (OTP-37 §6662 / OTP-32 Local File / OTP-33 Master File). Derived from the
   *  master-data composition over segment_pl / journal — no hardcoded figures. */
  documentation: () => getJSON<DocumentationRollup>('/api/documentation'),

  /** Withholding tax on IC royalty + service payments (OTP-46) — per-corridor
   *  treaty WHT due and treaty-vs-statutory saving. The withholdable base is
   *  derived from supply_chain; the bilateral treaty-rate matrix is a seed. */
  wht: (period: PeriodParams = {}) =>
    getJSON<WhtModel>('/api/wht', period as Record<string, unknown>),

  /** IC loan register + cash-pool positions with computed annual interest
   *  (OTP-6 rate setting / OTP-13 loan accrual / OTP-14 pool settlement). The
   *  register + pool positions are FABRICATED (no warehouse source); interest
   *  is computed as principal x all_in_rate and balance x spread. */
  treasury: () => getJSON<TreasuryModel>('/api/treasury'),

  /** Research Brain agentic "prepare steps" hand-off (logs an assisted event). */
  researchBrainPrepare: (body: {
    process_id: string;
    record_ref: string;
    entity_id?: string;
    gap_pp?: number;
    postings?: number;
    summary?: string;
  }) =>
    sendJSON<{
      summary: string;
      draftPatch: { mode: string; amount: number; gapPp: number; postings: number } | null;
      actor: string;
      event_id: number;
    }>('POST', '/api/research-brain/prepare', body),

  /** Process-aware TP knowledge Q&A (researchbrain retrieval, with fallback). */
  researchBrainAsk: (body: {
    question: string;
    process_id?: string;
    jurisdiction?: string;
    tp_method?: string;
  }) =>
    sendJSON<{
      answer: string;
      citations: { source: string; ref: string; snippet: string }[];
      live: boolean;
    }>('POST', '/api/research-brain/ask', body),

  // ---- Master Data ----
  mdFunctions: () => getJSON<TpFunction[]>('/api/master-data/functions'),
  mdEntities: () => getJSON<MdEntityRow[]>('/api/master-data/entities'),
  mdTransactionTypes: () => getJSON<MdTransactionType[]>('/api/master-data/transaction-types'),
  mdMatrix: () => getJSON<MdMatrixRow[]>('/api/master-data/matrix'),
  mdPutOverlay: (
    ctxId: string,
    body: { policy_ref?: string; ica_ref?: string; apa_ref?: string; target_override?: number; notes?: string; actor: string },
  ) => sendJSON<MdOverlayRow>('PUT', `/api/master-data/overlay/${encodeURIComponent(ctxId)}`, body),
  mdAddEntityFunction: (
    body: { rbukrs: string; tp_function_code: string; tested_party?: boolean; applies_to?: string[]; is_primary?: boolean; actor: string },
  ) => sendJSON<{ rbukrs: string; tp_function_code: string }>('POST', '/api/master-data/entity-function', body),
  mdStaging: () => getJSON<MdStagingItem[]>('/api/master-data/staging'),
  mdSimulate: () => sendJSON<MdSimulateResult>('POST', '/api/master-data/staging/simulate'),
  mdPromoteFlow: (body: { flow_id: string; payer_rbukrs: string; counterparty_rbukrs: string; label?: string; amount?: number }) =>
    sendJSON<{ id: string; status: string }>('POST', '/api/master-data/staging/promote', body),
  mdPropose: (id: string) => sendJSON<MdProposal>('POST', `/api/master-data/staging/${encodeURIComponent(id)}/propose`),
  mdSubmitMapping: (id: string, maker: string) =>
    sendJSON<{ id: string; status: string }>('POST', `/api/master-data/staging/${encodeURIComponent(id)}/submit`, { maker }),
  mdApproveMapping: (id: string, checker: string, comments?: string) =>
    sendJSON<{ id: string; status: string }>('POST', `/api/master-data/staging/${encodeURIComponent(id)}/approve`, { checker, comments }),
  mdRejectMapping: (id: string, checker: string, comments: string) =>
    sendJSON<{ id: string; status: string }>('POST', `/api/master-data/staging/${encodeURIComponent(id)}/reject`, { checker, comments }),

  // ---- Cases (Case Workspace — OTP-30/31/40/50) ----
  /** Governance cases for a process (optionally filtered by status). */
  cases: (params: { process_id?: string; status?: string } = {}) =>
    getJSON<Case[]>('/api/cases', params),
  case: (id: string) => getJSON<Case>(`/api/cases/${encodeURIComponent(id)}`),
  setCaseStatus: (id: string, body: { status: string; actor: string }) =>
    sendJSON<Case>('PATCH', `/api/cases/${encodeURIComponent(id)}/status`, body),
  setCaseStep: (id: string, body: { step_key: CaseStep['key']; done: CaseStep['done']; actor: string }) =>
    sendJSON<Case>('PATCH', `/api/cases/${encodeURIComponent(id)}/checklist`, body),
};
