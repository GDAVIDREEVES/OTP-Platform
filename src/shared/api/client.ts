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
  CloseStatus,
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
  VatModel,
  TreasuryModel,
  StewardshipModel,
  Catalog,
  CatalogEntry,
  ProvenanceRollup,
  Parameter,
  CalcDef,
  CalcDefResolved,
  CalcRun,
  CalcRunResult,
  CalcRunShaped,
  CalcGraph,
  CockpitNodeTypes,
  CockpitGraph,
  CockpitGraphValidation,
  CockpitGraphPreview,
  Scenario,
  ScenarioCompare,
  UserCalc,
  UserCalcStatus,
  UserCalcTerms,
  UserCalcTestRun,
  ExprValidation,
  ExprPreview,
  AllocationRun,
  AllocationRunDetail,
  AllocationRunLaunch,
  AllocationCharge,
  AllocationRecon,
  AllocationExceptionReport,
  AllocationArtifact,
  AllocationChargeLineage,
  AllocationDoc,
  AllocationDimensions,
  AuthoredPool,
  AuthoredPoolStatus,
  AuthoredPoolDefinition,
  AuthoredCaptureRule,
  AuthoredPoolValidation,
  CapturePreview,
  AuthoredTestResult,
  AuthoredRunResult,
  StageGraphPreview,
  DatasetSourcesCatalog,
  DatasetPreview,
  DatasetValidation,
  AuthoredDataset,
  AuthoredDatasetStatus,
  AuthoredDatasetTestResult,
  WaterfallRun,
  WaterfallRunDetail,
  PlAdjusted,
  PlBasis,
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

  /** `pl` (W2) selects the P&L basis: base | post_charge; omitted = the
   *  governed pl.use_post_charge parameter resolves it server-side. */
  kpis: (period: PeriodParams & { pl?: PlBasis } = {}) =>
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

  marginTrend: (params: { entityIds?: string[]; pl?: PlBasis } & PeriodParams = {}) => {
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

  /** Latest-Estimate forecast per tested party (OTP-24) — derived from segment_pl actuals by run-rate.
   *  `pl` (W2) selects the basis; omitted = the governed pl.use_post_charge parameter. */
  forecast: (year?: number, pl?: PlBasis) =>
    getJSON<ForecastModel>('/api/forecast', { ...(year ? { year } : {}), ...(pl ? { pl } : {}) }),

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

  /** Unified worklist ("My work" on /home) — the user's cross-process "what's
   *  on my plate" feed (drafts, review items, OTP-20 exceptions, open cases),
   *  overdue-first. */
  worklist: (userId: string) => getJSON<WorklistItem[]>('/api/worklist', { user: userId }),

  /** Live close-cycle status — the ordered 8-step close sequence with per-step
   *  status/owner/counts/route plus the active P&L basis. Read-only aggregation
   *  over signals the platform already keeps (Close Command Center home). */
  closeStatus: (userId: string, year: number) =>
    getJSON<CloseStatus>('/api/close/status', { user: userId, year }),

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

  // ------------ Data catalog + provenance (OTP-49 console — Phase 2c) ------------

  /** The full governed data catalog — warehouse views, SQLite tables, seeds, parameters. */
  catalog: () => getJSON<Catalog>('/api/catalog'),

  /** One catalog entry by id (e.g. "warehouse:segment_pl", "seed:treasury"). */
  catalogEntry: (id: string) => getJSON<CatalogEntry>(`/api/catalog/${encodeURIComponent(id)}`),

  /** Provenance rollup — every source + parameter grouped real|assumed|fabricated. */
  catalogProvenance: () => getJSON<ProvenanceRollup>('/api/catalog/provenance'),

  // ------------ Governed parameter store (OTP-49 console — Phase 2a) ------------

  /** Every governed calc parameter (optionally filtered by category), key-ordered. */
  parameters: (category?: string) =>
    getJSON<Parameter[]>('/api/parameters', category ? { category } : {}),

  /** One governed parameter by key (404 if unknown). */
  parameter: (key: string) => getJSON<Parameter>(`/api/parameters/${encodeURIComponent(key)}`),

  /** Edit a parameter's value — hash-chained at param:{key}. ``value`` is free-form
   *  JSON (scalar | list | dict); ``rationale`` is recorded in the audit event. */
  patchParameter: (key: string, body: { value: unknown; actor: string; rationale?: string }) =>
    sendJSON<Parameter>('PATCH', `/api/parameters/${encodeURIComponent(key)}`, body),

  /** Reset a parameter to its governed default — also hash-chained at param:{key}. */
  resetParameter: (key: string, body: { actor: string }) =>
    sendJSON<Parameter>('POST', `/api/parameters/${encodeURIComponent(key)}/reset`, body),

  // ------------ Calc Studio (calculation registry + run console — CS-a/CS-b) ------------

  /** Every registered calculation, each with its most recent run attached (or null). */
  calcs: () => getJSON<CalcDef[]>('/api/calcs'),

  /** One calculation with its inputs resolved — full catalog entries + governed parameter rows. */
  calc: (id: string) => getJSON<CalcDefResolved>(`/api/calcs/${encodeURIComponent(id)}`),

  /** Execute a calculation now. Persists the run (digest + summary + trace — never
   *  the output body) and hash-chains a "run" event at record_ref="calc:{id}". */
  runCalc: (
    id: string,
    body: { actor: string; args?: Record<string, unknown>; scenario_id?: string }
  ) => sendJSON<CalcRunResult>('POST', `/api/calcs/${encodeURIComponent(id)}/run`, body),

  /** Run history for one calculation, newest first. */
  calcRuns: (id: string) => getJSON<CalcRun[]>(`/api/calcs/${encodeURIComponent(id)}/runs`),

  /** The global run console, newest first (optionally filtered). */
  runs: (params: { calc_id?: string; scenario_id?: string; status?: string } = {}) =>
    getJSON<CalcRun[]>('/api/runs', params),

  /** One run by id (404 if unknown). */
  run: (runId: number) => getJSON<CalcRun>(`/api/runs/${runId}`),

  /** One run with its shaped explain-steps attached (CS-d) — historical runs
   *  shape retroactively from the persisted summary + raw trace. */
  shapedRun: (runId: number) => getJSON<CalcRunShaped>(`/api/runs/${runId}`, { shaped: true }),

  /** The dependency DAG — sources | parameters | calculations | processes —
   *  assembled from the calculation registry seed (CS-d Lineage tab). */
  calcsGraph: () => getJSON<CalcGraph>('/api/calcs/graph'),

  // ------------ Model Canvas cockpit graph (Phase 7 MC1/MC2) ------------

  /** The cockpit palette catalogue — every node type's handle/config schema
   *  plus the live measure allowlist, governed parameters (with current
   *  values) and composable system calcs. Pure read. */
  cockpitNodeTypes: () => getJSON<CockpitNodeTypes>('/api/calc-graph/node-types'),

  /** Structural validation of a canvas graph (acyclic, one output, typed
   *  handles, no under-specified config) — nothing persists. */
  validateGraph: (graph: CockpitGraph) =>
    sendJSON<CockpitGraphValidation>('POST', '/api/calc-graph/validate', { graph }),

  /** Compile + evaluate the graph (traced): the whole-graph result, a value
   *  per node, the raw trace and per-node exceptions. ``overrides`` (the
   *  Scenario side of the Base⟷Scenario toggle) re-runs the whole preview under
   *  the existing scenario overlay — nothing persists. */
  previewGraph: (graph: CockpitGraph, overrides?: Record<string, unknown>) =>
    sendJSON<CockpitGraphPreview>('POST', '/api/calc-graph/preview', {
      graph,
      ...(overrides && Object.keys(overrides).length ? { overrides } : {}),
    }),

  /** The canvas graph for a user calculation — its stored graph_json when
   *  authored on the canvas, else expr_to_graph(expression) so a formula calc
   *  still visualises (the expression stays the source of truth). */
  userCalcGraph: (id: string) =>
    getJSON<CockpitGraph>(`/api/user-calcs/${encodeURIComponent(id)}/graph`),

  /** Create a draft calculation FROM A CANVAS GRAPH (the graph compiles to an
   *  expression first; both persist, the expression is the source of truth). */
  createUserCalcGraph: (body: {
    name: string;
    graph: CockpitGraph;
    description?: string;
    process_id?: string;
    output_grain?: string;
    actor: string;
  }) => sendJSON<UserCalc>('POST', '/api/user-calcs', body),

  /** Edit a calculation's formula FROM A CANVAS GRAPH (resets the test gate;
   *  editing an active calc bumps the version back to draft). */
  patchUserCalcGraph: (
    id: string,
    body: {
      name?: string;
      description?: string;
      graph?: CockpitGraph;
      output_grain?: string;
      process_id?: string;
      actor: string;
    }
  ) => sendJSON<UserCalc>('PATCH', `/api/user-calcs/${encodeURIComponent(id)}`, body),

  // ------------ What-if scenarios (Calc Studio — CS-c) ------------

  /** Every scenario, newest first (optionally filtered by status). */
  scenarios: (status?: string) => getJSON<Scenario[]>('/api/scenarios', status ? { status } : {}),

  /** One scenario by id (404 if unknown). */
  scenario: (id: string) => getJSON<Scenario>(`/api/scenarios/${encodeURIComponent(id)}`),

  /** Create a draft scenario — overrides map governed parameter keys to what-if
   *  values; every mutation is hash-chained at scenario:{id}. */
  createScenario: (body: {
    name: string;
    description?: string;
    overrides: Record<string, unknown>;
    actor: string;
  }) => sendJSON<Scenario>('POST', '/api/scenarios', body),

  /** Edit a DRAFT scenario (409 once in_review/promoted/discarded). */
  patchScenario: (
    id: string,
    body: { name?: string; description?: string; overrides?: Record<string, unknown>; actor: string }
  ) => sendJSON<Scenario>('PATCH', `/api/scenarios/${encodeURIComponent(id)}`, body),

  /** Run a calc twice — governed base vs scenario overlay — and diff them.
   *  Both runs persist to the run console; the store is never written. */
  compareScenario: (
    id: string,
    body: { calc_id: string; actor: string; args?: Record<string, unknown> }
  ) => sendJSON<ScenarioCompare>('POST', `/api/scenarios/${encodeURIComponent(id)}/compare`, body),

  /** Submit for promotion: status -> in_review + a pending maker-checker item
   *  at scenario:{id}. A DIFFERENT reviewer must approve in /review. */
  promoteScenario: (id: string, body: { maker: string }) =>
    sendJSON<Scenario>('POST', `/api/scenarios/${encodeURIComponent(id)}/promote`, body),

  /** Discard a scenario (terminal — the audit chain at scenario:{id} remains). */
  discardScenario: (id: string, body: { actor: string }) =>
    sendJSON<Scenario>('POST', `/api/scenarios/${encodeURIComponent(id)}/discard`, body),

  // ------------ User-authored calculations (Calculation Builder — W3/W4) ------------

  /** Every user-authored calculation, newest first (optionally by status). */
  userCalcs: (status?: UserCalcStatus) =>
    getJSON<UserCalc[]>('/api/user-calcs', status ? { status } : {}),

  /** One user calculation by id (404 if unknown). */
  userCalc: (id: string) => getJSON<UserCalc>(`/api/user-calcs/${encodeURIComponent(id)}`),

  /** The Builder's term-picker allowlist — measure tables/columns/grains/
   *  filters (the same registry validate/preview enforce) + the legal output
   *  grains + the non-composable calc ids. */
  userCalcTerms: () => getJSON<UserCalcTerms>('/api/user-calcs/terms'),

  /** Syntax + term-resolution report — pure read, nothing persists (the
   *  Builder validates live as the formula is typed). */
  validateUserCalc: (expression: string) =>
    sendJSON<ExprValidation>('POST', '/api/user-calcs/validate', { expression }),

  /** Evaluate an expression (the Builder's Preview) — nothing persists. */
  previewUserCalc: (expression: string) =>
    sendJSON<ExprPreview>('POST', '/api/user-calcs/preview', { expression }),

  /** Create a draft calculation — hash-chained "created" at ucalc:{id}. */
  createUserCalc: (body: {
    name: string;
    expression: string;
    description?: string;
    process_id?: string;
    output_grain?: string;
    actor: string;
  }) => sendJSON<UserCalc>('POST', '/api/user-calcs', body),

  /** Edit a calculation (409 while in_review). A formula/grain change resets
   *  the test gate; editing an ACTIVE calc bumps the version back to draft. */
  patchUserCalc: (
    id: string,
    body: {
      name?: string;
      description?: string;
      expression?: string;
      output_grain?: string;
      process_id?: string;
      actor: string;
    }
  ) => sendJSON<UserCalc>('PATCH', `/api/user-calcs/${encodeURIComponent(id)}`, body),

  /** Test-run the draft: evaluates (traced) and marks it tested on success —
   *  the gate submit-for-activation requires. */
  testUserCalc: (id: string, body: { actor: string }) =>
    sendJSON<UserCalcTestRun>('POST', `/api/user-calcs/${encodeURIComponent(id)}/test`, body),

  /** Submit for activation: status -> in_review + one pending maker-checker
   *  item at ucalc:{id} — a DIFFERENT reviewer must approve in /review. */
  submitUserCalcActivation: (id: string, body: { maker: string }) =>
    sendJSON<UserCalc>(
      'POST',
      `/api/user-calcs/${encodeURIComponent(id)}/submit-activation`,
      body
    ),

  // ------------ Allocation engine (Calc Studio Allocations workbench — M7) ------------

  /** Every allocation engine run (SPEC §3.2 run table), each with its
   *  persisted summary artifact attached (null until the run succeeded). */
  allocationRuns: (params: { period?: string; status?: string } = {}) =>
    getJSON<AllocationRun[]>('/api/allocation/runs', params),

  /** One run with its artifact index (doc pack, posting files, lineage, hash). */
  allocationRun: (runId: string) =>
    getJSON<AllocationRunDetail>(`/api/allocation/runs/${encodeURIComponent(runId)}`),

  /** Launch a budget | actual | trueup run (SPEC §6). A failed run is a domain
   *  outcome, not an HTTP error — it returns 200 with status "failed" plus the
   *  exception report. Every run is audited at allocation:{run_id}. */
  launchAllocationRun: (body: {
    run_type: string;
    actor: string;
    period?: string;
    year?: string;
    scope?: Record<string, unknown>;
    config?: Record<string, unknown>;
  }) => sendJSON<AllocationRunLaunch>('POST', '/api/allocation/runs', body),

  /** The run's append-only charge ledger rows (exact decimal strings). */
  allocationRunCharges: (runId: string) =>
    getJSON<AllocationCharge[]>(`/api/allocation/runs/${encodeURIComponent(runId)}/charges`),

  /** The run's recon rows — pooled = exclusions + recovered + residual (V-X1 zero). */
  allocationRunRecon: (runId: string) =>
    getJSON<AllocationRecon[]>(`/api/allocation/runs/${encodeURIComponent(runId)}/recon`),

  /** The SPEC §8.4 exception report: every fired V-rule with severity + remediation. */
  allocationRunExceptions: (runId: string) =>
    getJSON<AllocationExceptionReport>(
      `/api/allocation/runs/${encodeURIComponent(runId)}/exceptions`
    ),

  /** Index of the run's documentation pack (one Markdown page per pool). */
  allocationRunDocs: (runId: string) =>
    getJSON<AllocationArtifact[]>(`/api/allocation/runs/${encodeURIComponent(runId)}/docs`),

  /** One doc-pack page (SPEC §8.3 Markdown) for a pool of the run. */
  allocationRunDoc: (runId: string, poolId: string) =>
    getJSON<AllocationDoc>(
      `/api/allocation/runs/${encodeURIComponent(runId)}/docs/${encodeURIComponent(poolId)}`
    ),

  /** Drill a ledger charge to its allocation ratio, key value and constituent
   *  cost lines (true-up rows drill to their parent Budget charge). */
  allocationChargeLineage: (chargeId: string) =>
    getJSON<AllocationChargeLineage>(
      `/api/allocation/charges/${encodeURIComponent(chargeId)}/lineage`
    ),

  // ------------ Allocation Pool Builder (Phase 6 PB2/PB3) ------------

  /** Distinct cost_center / profit_center / cost_element values across the
   *  allocation cost lines, each with its TOTAL cost — the capture-rule pickers. */
  allocationDimensions: (source = 'actual') =>
    getJSON<AllocationDimensions>('/api/allocation/dimensions', { source }),

  /** Authored pools (governed experiments), newest first, optionally by status. */
  authoredPools: (status?: AuthoredPoolStatus) =>
    getJSON<AuthoredPool[]>('/api/allocation/pools', status ? { status } : {}),

  /** One authored pool (404 if unknown). */
  authoredPool: (poolId: string) =>
    getJSON<AuthoredPool>(`/api/allocation/pools/${encodeURIComponent(poolId)}`),

  /** Structural validation report {ok, errors} — nothing persists. */
  validateAuthoredPool: (definition: AuthoredPoolDefinition, actor: string) =>
    sendJSON<AuthoredPoolValidation>('POST', '/api/allocation/pools/validate', {
      definition,
      actor,
    }),

  /** Live capture-rule preview — captured $ / line count / by-entity (no persist). */
  previewCaptureRule: (rule: AuthoredCaptureRule & { source?: string }) =>
    sendJSON<CapturePreview>('POST', '/api/allocation/pools/preview', rule),

  /** Compile a canvas STAGE GRAPH (Phase 7 MC3) + dry-run it (Stages 1-7 in
   *  isolation) — per-stage results (captured cost, exclusions, allocated,
   *  markup, charges, recon zero-residual) keyed on the stage node id. No persist. */
  previewStageGraph: (graph: CockpitGraph, source?: string) =>
    sendJSON<StageGraphPreview>('POST', '/api/allocation/pools/preview-graph', {
      graph,
      ...(source ? { source } : {}),
    }),

  /** The canvas stage graph for an authored pool (its stored graph_json), or
   *  null when it was hand-authored (the definition stays the source of truth). */
  authoredPoolGraph: (poolId: string) =>
    getJSON<CockpitGraph | null>(`/api/allocation/pools/${encodeURIComponent(poolId)}/graph`),

  /** Create a draft authored pool (structurally validated up front). */
  createAuthoredPool: (definition: AuthoredPoolDefinition, actor: string, processId?: string) =>
    sendJSON<AuthoredPool>('POST', '/api/allocation/pools', {
      definition,
      actor,
      process_id: processId,
    }),

  /** Create a draft authored pool FROM A CANVAS STAGE GRAPH (Phase 7 MC3 — the
   *  graph compiles to a definition first; both persist, the definition is SoT). */
  createAuthoredPoolGraph: (graph: CockpitGraph, actor: string, processId?: string) =>
    sendJSON<AuthoredPool>('POST', '/api/allocation/pools', {
      graph,
      actor,
      process_id: processId,
    }),

  /** Edit an authored pool's stage graph (resets the test gate; an active pool
   *  versions + returns to draft). */
  updateAuthoredPoolGraph: (poolId: string, actor: string, graph: CockpitGraph) =>
    sendJSON<AuthoredPool>('PATCH', `/api/allocation/pools/${encodeURIComponent(poolId)}`, {
      actor,
      graph,
    }),

  /** Edit a pool (drafts in place; an active pool versions + returns to draft). */
  updateAuthoredPool: (
    poolId: string,
    actor: string,
    definition?: AuthoredPoolDefinition,
    processId?: string
  ) =>
    sendJSON<AuthoredPool>('PATCH', `/api/allocation/pools/${encodeURIComponent(poolId)}`, {
      actor,
      definition,
      process_id: processId,
    }),

  /** Delete a draft/tested pool. */
  deleteAuthoredPool: (poolId: string, actor: string) =>
    sendJSON<AuthoredPool>('DELETE', `/api/allocation/pools/${encodeURIComponent(poolId)}`, {
      actor,
    }),

  /** Dry-run the pool through Stages 1-7 in isolation (no persist) — on a sound
   *  result (recon Balanced, no BLOCK) it is marked `tested`, the activation gate.
   *  Returns the dry-run charges/recon/exceptions/trace either way. */
  testAuthoredPool: (poolId: string, actor: string) =>
    sendJSON<AuthoredTestResult>(
      'POST',
      `/api/allocation/pools/${encodeURIComponent(poolId)}/test`,
      { actor }
    ),

  /** Submit a tested pool for activation: status → in_review + one pending
   *  maker-checker item at allocpool:{id}. A DIFFERENT reviewer must approve. */
  submitAuthoredPoolActivation: (poolId: string, maker: string) =>
    sendJSON<AuthoredPool>(
      'POST',
      `/api/allocation/pools/${encodeURIComponent(poolId)}/submit-activation`,
      { maker }
    ),

  /** Launch an authored allocation run for a period — overlays every ACTIVE
   *  authored pool whose capture rule touches it (flagged authored). A failed
   *  run is a domain outcome (200, status "failed" + exception report). */
  runAuthoredAllocation: (body: { actor: string; period: string; source?: string }) =>
    sendJSON<AuthoredRunResult>('POST', '/api/allocation/authored-runs', body),

  // ------------ Dataset / data-prep layer (Phase 8 DS1/DS2/DS3) ------------

  /** The dataset palette catalogue: every source (warehouse views + the
   *  fabricated cost lines + active authored datasets) with columns + provenance
   *  + join keys, the data-prep node types, and the journal's distinct GL/CC/PC
   *  value lists. Pure read. */
  datasetSources: () => getJSON<DatasetSourcesCatalog>('/api/dataset/sources'),

  /** Structural + allowlist validation of a dataset graph (acyclic, single
   *  terminal, allowlisted columns/ops/keys) — nothing persists, no SQL runs. */
  validateDataset: (graph: CockpitGraph) =>
    sendJSON<DatasetValidation>('POST', '/api/dataset/validate', { graph }),

  /** Compile a dataset graph to ONE parameterized DuckDB query + run it ->
   *  {columns, rows (sample), row_count}. A graph problem returns a precise 400
   *  {message, node_id}. Nothing persists — the cockpit's tabular preview. */
  previewDataset: (graph: CockpitGraph, sampleLimit?: number) =>
    sendJSON<DatasetPreview>('POST', '/api/dataset/preview', {
      graph,
      ...(sampleLimit ? { sample_limit: sampleLimit } : {}),
    }),

  /** Authored datasets (governed, reusable data-prep graphs), newest first. */
  authoredDatasets: (status?: AuthoredDatasetStatus) =>
    getJSON<AuthoredDataset[]>('/api/datasets', status ? { status } : {}),

  /** One authored dataset (404 if unknown). */
  authoredDataset: (datasetId: string) =>
    getJSON<AuthoredDataset>(`/api/datasets/${encodeURIComponent(datasetId)}`),

  /** Create a draft authored dataset from a data-prep ``graph`` (the source of
   *  truth — it compiles to SQL). Structurally validated up front. */
  createAuthoredDataset: (body: {
    name: string;
    definition: CockpitGraph;
    description?: string;
    process_id?: string;
    actor: string;
  }) => sendJSON<AuthoredDataset>('POST', '/api/datasets', body),

  /** Edit a dataset's graph (resets the test gate; an active dataset versions +
   *  returns to draft). */
  updateAuthoredDataset: (
    datasetId: string,
    body: { name?: string; description?: string; definition?: CockpitGraph;
            process_id?: string; actor: string }
  ) => sendJSON<AuthoredDataset>('PATCH', `/api/datasets/${encodeURIComponent(datasetId)}`, body),

  /** Compile + run the dataset graph (no persist). On success it is marked
   *  ``tested`` — the gate submit-activation requires. Returns the preview. */
  testAuthoredDataset: (datasetId: string, actor: string) =>
    sendJSON<AuthoredDatasetTestResult>(
      'POST', `/api/datasets/${encodeURIComponent(datasetId)}/test`, { actor }),

  /** Submit a tested dataset for activation: status → in_review + one pending
   *  maker-checker item at dataset:{id}. A DIFFERENT reviewer must approve. */
  submitAuthoredDatasetActivation: (datasetId: string, maker: string) =>
    sendJSON<AuthoredDataset>(
      'POST', `/api/datasets/${encodeURIComponent(datasetId)}/submit-activation`,
      { maker }),

  // ------------ TP waterfall + post-charge P&L (Phase 5 W1/W2) ------------

  /** Every waterfall run, oldest first (optionally filtered by status —
   *  at most ONE run is 'applied' at any time). */
  waterfallRuns: (status?: string) =>
    getJSON<WaterfallRun[]>('/api/waterfall/runs', status ? { status } : {}),

  /** One run with its overlay ledger lines (404 if unknown). */
  waterfallRun: (runId: string) =>
    getJSON<WaterfallRunDetail>(`/api/waterfall/runs/${encodeURIComponent(runId)}`),

  /** Launch a waterfall run (default sequence: service_allocation →
   *  royalties → csa_true_up → profit_split). A failed run is a domain
   *  outcome (200, status "failed", nothing applied); the new run supersedes
   *  the previously applied one. Audited at waterfall:{run_id}. */
  runWaterfall: (body: { actor: string; year?: number; steps?: string[] }) =>
    sendJSON<WaterfallRun>('POST', '/api/waterfall/runs', body),

  /** Roll an applied run back — one REVERSING overlay row per line (the
   *  ledger stays append-only), run status → rolled_back. */
  rollbackWaterfall: (runId: string, body: { actor: string }) =>
    sendJSON<WaterfallRun & { reversed_lines: number }>(
      'POST',
      `/api/waterfall/runs/${encodeURIComponent(runId)}/rollback`,
      body
    ),

  /** Base segment_pl aggregate | applied overlay | post-charge totals per
   *  entity (or entity-function), with per-line provenance. With no
   *  waterfall applied every post-charge column equals base. */
  plAdjusted: (params: { year?: number; grain?: 'entity' | 'entity_function' } = {}) =>
    getJSON<PlAdjusted>('/api/pl/adjusted', params),

  /** Per-entity covered-transaction rollup for the documentation workpapers
   *  (OTP-37 §6662 / OTP-32 Local File / OTP-33 Master File). Derived from the
   *  master-data composition over segment_pl / journal — no hardcoded figures. */
  documentation: () => getJSON<DocumentationRollup>('/api/documentation'),

  /** Withholding tax on IC royalty + service payments (OTP-46) — per-corridor
   *  treaty WHT due and treaty-vs-statutory saving. The withholdable base is
   *  derived from supply_chain; the bilateral treaty-rate matrix is a seed. */
  wht: (period: PeriodParams = {}) =>
    getJSON<WhtModel>('/api/wht', period as Record<string, unknown>),

  /** VAT / indirect-tax impact on IC royalty, service + goods legs (OTP-19) —
   *  per-jurisdiction VATable base, VAT charged, recoverable input VAT and net
   *  (non-recoverable) cost leakage. The base is derived from supply_chain; the
   *  standard rate matrix + recoverability flags are an illustrative seed. */
  vat: (period: PeriodParams = {}) =>
    getJSON<VatModel>('/api/vat', period as Record<string, unknown>),

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
