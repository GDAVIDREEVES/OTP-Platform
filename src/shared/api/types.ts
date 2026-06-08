/**
 * Response/request types for the FastAPI backend.
 * Keep in sync with `backend/main.py` (after layering: `backend/routers/`,
 * `backend/schemas/`).
 */

export interface KpiSummary {
  totalICVolume: number;
  entityCount: number;
  entitiesInRange: number;
  entitiesWatch: number;
  entitiesOutOfRange: number;
  /** Entities with no P&L data for the period (status 'no-data'). */
  entitiesNoData: number;
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
  AWREF: string | null;
  HSL: number;
  RHCUR: string;
  SGTXT: string;
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
  reversesId?: string; // present on counter-adjustments — points back to original
  reversedById?: string; // present on originals after reversal — points to counter
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

// ----------------- Phase 2: state layer (audit / drafts / review) -----------------

export interface AuditEvent {
  id: number;
  ts: string;
  actor: string;
  actor_kind: 'human' | 'assistant';
  process_id: string | null;
  record_ref: string;
  event_type: string;
  before: unknown;
  after: unknown;
  rationale: string | null;
  prev_hash: string;
  hash: string;
}

export interface Draft {
  id: number;
  user_id: string;
  process_id: string;
  record_ref: string;
  step: string;
  step_index: number;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ReviewItem {
  id: number;
  process_id: string;
  record_ref: string;
  maker: string;
  checker: string | null;
  status: 'pending' | 'approved' | 'rejected';
  comments: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface ChainVerify {
  ok: boolean;
  broken_at: number | null;
}

export interface EvidenceDiff {
  event_id: number;
  event_type: string;
  ts: string;
  actor: string;
  changes: { field: string; from: unknown; to: unknown }[];
}

export interface EvidencePacket {
  record_ref: string;
  subject: string | null;
  events: AuditEvent[];
  diffs: EvidenceDiff[];
  postings: JournalEntryRow[];
  verify: ChainVerify;
}

// ----------------- Master Data -----------------

export interface TpFunction {
  code: string;
  label: string;
  default_method: string;
  default_pli: string;
  typically_tested: boolean;
}

export interface MdEntityRow {
  rbukrs: string;
  display_name: string;
  country: string | null;
  functional_currency: string | null;
  tp_function_code: string;
  tp_function_label: string;
  is_primary: boolean;
  tested_party: boolean;
  applies_to: string[];
  participates_in: string[];
}

export interface MdTransactionType {
  txn_type_id: string;
  label: string;
  category: string;
  method: string;
  pli: string;
  benchmark_set_id: string;
  oecd_anchor: string;
  characterising_function: string;
}

export interface MdMatrixParty {
  rbukrs: string;
  name: string;
  role: string;
}

export interface MdMatrixRow {
  ctx_id: string;
  txn_type_id: string | null;
  txn_label: string | null;
  category: string | null;
  method: string | null;
  pli: string | null;
  lower: number | null;
  median: number | null;
  upper: number | null;
  unit: string | null;
  actual: number | null;
  status: 'in_range' | 'review' | 'na' | 'unmapped';
  planned: boolean;
  actual_amount: number | null;
  flow_id: string | null;
  staging_id: string | null;
  oecd_anchor: string | null;
  payer: MdMatrixParty;
  payee: MdMatrixParty;
  tested: MdMatrixParty;
  policy_ref: string | null;
  ica_ref: string | null;
  apa_ref: string | null;
  benchmark_set_id: string | null;
}

export interface MdStagingItem {
  id: string;
  kind: 'entity' | 'account' | 'transaction' | 'field' | 'unplanned_transaction';
  raw: Record<string, unknown>;
  status: 'unmapped' | 'proposed' | 'in_review' | 'applied' | 'rejected';
  proposed: Record<string, unknown> | null;
  confidence: string | null;
  rationale: string | null;
  maker: string | null;
}

export interface MdProposal {
  proposed: Record<string, unknown>;
  confidence: string;
  rationale: string;
  live: boolean;
  citations: { source: string; note?: string }[];
  event_id: number;
}

export interface MdOverlayRow {
  ctx_id: string;
  policy_ref: string | null;
  ica_ref: string | null;
  apa_ref: string | null;
  target_override: number | null;
  notes: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

export interface MdSimulateResult {
  id: string | null;
  kind: string | null;
  raw: Record<string, unknown>;
}

export interface IntercompanyFlow {
  from_rbukrs: string;
  to_rbukrs: string;
  amount: number;
}

// ----------------- Documentation rollup (OTP-37 / OTP-32 / OTP-33) -----------------

/** One covered transaction under a tested entity's documentation workpaper:
 *  FAR/method narrative, benchmark range, governing refs, linked evidence ref. */
export interface DocCoveredRow {
  ctx_id: string;
  txn_type_id: string | null;
  txn_label: string | null;
  category: string | null;
  method: string | null;
  pli: string | null;
  lower: number | null;
  median: number | null;
  upper: number | null;
  unit: string | null;
  actual: number | null;
  status: 'in_range' | 'review' | 'na' | 'unmapped';
  oecd_anchor: string | null;
  benchmark_set_id: string | null;
  policy_ref: string | null;
  ica_ref: string | null;
  apa_ref: string | null;
  payer: MdMatrixParty;
  payee: MdMatrixParty;
  tested: MdMatrixParty;
  /** Resolves via /api/evidence to the entity's audit + ACDOCA postings + chain. */
  evidence_ref: string;
}

export interface DocEntity {
  rbukrs: string;
  display_name: string;
  country: string | null;
  functional_currency: string | null;
  tp_function_code: string | null;
  tp_function_label: string | null;
  tested_party: boolean;
  covered: DocCoveredRow[];
  covered_count: number;
  in_range: number;
  review: number;
  evidence_ref: string;
}

export interface DocumentationRollup {
  entities: DocEntity[];
  totals: { entities: number; covered: number; in_range: number; review: number };
}

// ----------------- Pricing (goods & services price-setting — OTP-4 / OTP-1 / OTP-2) -----------------

/** A settable per-material price row: one chain+material, with the cost-plus
 *  inputs, resulting legal price, TP method, and the benchmarking band. */
export interface PricingRow {
  id: string;
  chainId: string;
  materialType: 'SERVICE' | 'FG' | 'SEMI' | 'RAW';
  category: string;
  transactionType: 'service' | 'goods';
  matnr: string | null;
  sellerRole: string;
  buyerRole: string;
  seller: string;
  buyer: string;
  sellerCode: string;
  buyerCode: string;
  standardCost: number;
  markupRate: number; // percent
  totalLegalPrice: number;
  tpMethod: string;
  pli: string;
  steps: number;
  benchmarkId: string;
  benchmarkLabel: string;
  benchmarkRange: string;
  benchmarkMedian: number;
  withinBenchmark: boolean;
  apa: boolean;
  challenged: boolean;
}

// ----------------- CSA (Cost Sharing Arrangement — OTP-5 / OTP-11) -----------------

export interface CsaParticipant {
  rbukrs: string;
  name: string;
  revenue: number;
  projected_sales: number;
  rab_share: number;
  opex_rd: number;
  target_contribution: number;
  true_up: number;
  pct_buyin: number;
}

export interface CsaModel {
  year: number;
  pool: number;
  platform_value: number;
  growth: number;
  pct_mult: number;
  totals: { revenue: number; opex_rd: number; true_up: number };
  participants: CsaParticipant[];
}

// ----------------- Profit split (OTP-44 design / OTP-12 calc & invoicing) -----------------

/** Allocation key for the residual profit-split: R&D value-driver or SG&A. */
export type ProfitSplitKey = 'opex_rd' | 'sga';

export interface ProfitSplitParticipant {
  rbukrs: string;
  name: string;
  /** The party's own operating profit (segment_pl). */
  operating_profit: number;
  opex_rd: number;
  /** opex_sm + opex_ga. */
  sga: number;
  /** The selected allocation-key value for this party. */
  key_value: number;
  /** key_value / Σ key_value — full precision. */
  residual_share: number;
  /** residual_share * combined_profit. */
  allocated_profit: number;
  /** allocated_profit − operating_profit (positive = receives, negative = owes). */
  true_up: number;
}

/** Residual profit-split across the non-routine parties, computed live from
 *  segment_pl. Combined profit = Σ participant operating_profit; the residual is
 *  allocated by the selectable `key`. */
export interface ProfitSplitModel {
  year: number;
  key: ProfitSplitKey;
  default_key: ProfitSplitKey;
  keys: ProfitSplitKey[];
  combined_profit: number;
  key_total: number;
  totals: { operating_profit: number; allocated_profit: number; true_up: number };
  participants: ProfitSplitParticipant[];
}

// ----------------- Forecast (Latest-Estimate workpaper — OTP-24) -----------------

/** Per-tested-party full-year Latest Estimate derived from segment_pl actuals
 *  by run-rate (NOT a seeded budget). LE = actuals-to-date + forecast remainder. */
export interface ForecastParty {
  rbukrs: string;
  name: string;
  country: string;
  function: string;
  roleCode: string;
  tpRole: string;
  monthsPosted: number;
  monthsRemaining: number;
  actuals: { revenue: number; operating_profit: number; margin: number | null };
  forecastRemainder: { revenue: number; operating_profit: number };
  latestEstimate: { revenue: number; operating_profit: number };
  /** Full-year LE operating margin, percent. */
  fullYearMargin: number | null;
  targetMarginLow: number;
  targetMarginHigh: number;
  targetMarginLabel: string;
  variance: number | null;
  status: 'in-range' | 'watch' | 'out-of-range' | 'no-data';
}

export interface ForecastModel {
  year: number;
  fullYearMonths: number;
  /** Projection basis — 'run-rate' (run-rate / simple seasonality on actuals-to-date). */
  basis: string;
  parties: ForecastParty[];
}

// ----------------- Cases (Case Workspace — OTP-30/31/40/50) -----------------

export interface CaseStep {
  key: string;
  label: string;
  done: boolean;
}

export interface Case {
  id: string;
  process_id: string;
  kind: string;
  title: string;
  status: 'open' | 'in_progress' | 'submitted' | 'closed';
  owner: string;
  counterparty: string | null;
  jurisdiction: string | null;
  exposure: number | null;
  opened_at: string;
  due_at: string | null;
  checklist: CaseStep[];
  notes: string | null;
}

// ----------------- ERP↔TP reconciliation (OTP-43 recon / OTP-42 billing) -----------------

export type ReconStatus = 'reconciled' | 'unposted' | 'value-break' | 'challenged';

/** One planned intercompany flow (supply_chain, keyed by AWREF) tied to its
 *  posted ACDOCA value (journal HSL by AWREF). The shared source behind the
 *  OTP-43 reconciliation worklist and the OTP-42 billing exceptions queue. */
export interface ReconRow {
  awref: string;
  seller: string;
  buyer: string;
  sellerName: string;
  buyerName: string;
  tpMethod: string;
  materialType: string;
  gjahr: number;
  poper: string;
  planned: number;
  posted: number | null;
  delta: number;
  postings: number;
  challenged: boolean;
  apa: boolean;
  status: ReconStatus;
}

export interface ReconSummary {
  reconciled: number;
  unposted: number;
  'value-breaks': number;
  challenged: number;
  total: number;
  planned_total: number;
  posted_total: number;
  delta_total: number;
}

export interface Reconciliation {
  summary: ReconSummary;
  rows: ReconRow[];
}

/** One withholding-tax corridor on an IC royalty / service payment (OTP-46).
 *  Derived from supply_chain (the real withholdable base) joined to the
 *  illustrative, OECD-model-aligned bilateral treaty-rate seed. */
export interface WhtRow {
  id: string;
  payment_type: 'Royalty' | 'Service';
  material_type: string;
  payer: string;
  payee: string;
  payer_country: string;
  payee_country: string;
  corridor: string;
  gross: number;
  treaty_rate: number;
  statutory_rate: number;
  wht_due: number;
  treaty_saving: number;
  basis: string;
}

export interface WhtTotals {
  corridors: number;
  gross: number;
  wht_due: number;
  treaty_saving: number;
  statutory_due: number;
}

export interface WhtModel {
  rows: WhtRow[];
  totals: WhtTotals;
}
