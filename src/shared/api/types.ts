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

/** Per-flow editable override (TP method, PLI, arm's-length range bounds,
 *  deviation threshold, reviewer, approver, notes). */
export interface PolicyOverride {
  flowId: string;
  tpMethod?: string;
  pli?: string;
  rangeLow?: string;
  rangeHigh?: string;
  deviationThreshold?: string;
  reviewer?: string;
  approver?: string;
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

/** One step in a record's cross-process lineage/timeline feed (GET /api/lineage).
 *  A handoff event carries the from/to process pair in `after` ({from, to}). */
export interface LineageStep {
  id: number;
  ts: string;
  actor: string;
  actor_kind: 'human' | 'assistant';
  process_id: string | null;
  record_ref: string;
  event_type: string;
  rationale: string | null;
  /** For a `handoff` event, the originating/receiving process pair. */
  before?: unknown;
  after?: { from?: string; to?: string } | null;
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

/** One row in the unified worklist ("My work" on /home) — a cross-process
 *  "what's on my plate" feed aggregating drafts, review items, OTP-20
 *  exceptions, and open cases. Read-only: `route` deep-links back to the
 *  owning work surface. */
export interface WorklistItem {
  kind: 'draft' | 'review' | 'exception' | 'case';
  title: string;
  ref: string;
  process_id: string | null;
  route: string | null;
  due_at: string | null;
  priority: 'high' | 'medium' | 'low';
  status: string;
}

/** The backend's status for a `kind: 'review'` worklist row that is the
 *  current persona's OWN submission, parked with someone else (segregation
 *  of duties) — passive, nothing for this user to do. Mirrors
 *  backend/routers/worklist.py `_review_items`. */
export const WORKLIST_STATUS_AWAITING_CHECKER = 'awaiting checker';

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

// ----------------- Stewardship cost identification (OTP-15) -----------------

/** One candidate parent cost line screened for shareholder/stewardship character.
 *  FABRICATED governance record; `stewardship` true ⇒ excluded from the cost base. */
export interface StewardshipLine {
  id: string;
  rbukrs: string;
  name: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  /** Server default classification; the frontend lets the user re-toggle this. */
  stewardship: boolean;
  rationale: string;
}

/** Stewardship cost review for the parents. The `cost_base` is REAL (Σ parent
 *  `opex_ga` from segment_pl); the candidate `lines` are fabricated. `excluded`
 *  is the sum of stewardship-flagged lines; `adjusted_cost_base = cost_base − excluded`. */
export interface StewardshipModel {
  year: number;
  base_col: string;
  parents: { rbukrs: string; name: string; cost_base: number }[];
  cost_base: number;
  candidate_total: number;
  excluded: number;
  adjusted_cost_base: number;
  lines: StewardshipLine[];
}

// ----------------- BEAT base-erosion prep (OTP-36 / OTP-38) -----------------

/** One §59A payment type, with its classified related-party amount. COGS is the
 *  excepted (non base-eroding) type. */
export interface BeatPaymentType {
  type: 'royalties' | 'services' | 'interest' | 'cogs' | 'other';
  label: string;
  amount: number;
  base_eroding: boolean;
}

/** Per-G/L-account (RACCT) breakdown of the US related-party deductible base. */
export interface BeatAccountRow {
  racct: string;
  payment_type: BeatPaymentType['type'];
  base_eroding: boolean;
  amount: number;
  postings: number;
}

/** Per-CFC (RASSC counterparty) Form 5471 Schedule M rollup — amounts the US
 *  payer paid to / received from the affiliate, plus its foreign segment_pl P&L. */
export interface BeatScheduleMRow {
  rbukrs: string;
  name: string;
  paid_to: number;
  received_from: number;
  postings: number;
  foreign_revenue: number;
  foreign_operating_profit: number;
}

/** BEAT base-erosion computation (OTP-36) + per-CFC Schedule M rollup (OTP-38).
 *  The related-party deductible base is REAL (journal RASSC lines); the
 *  RACCT→payment-type classification driving the base-erosion split is the
 *  assumed/fabricated input. */
export interface BeatModel {
  year: number;
  us_payer: string;
  us_payer_name: string;
  threshold_pct: number;
  beat_rate_pct: number;
  gross_receipts: number;
  total_deductions: number;
  related_party_deductions: number;
  cogs_excluded: number;
  base_eroding_payments: number;
  base_erosion_pct: number;
  threshold_met: boolean;
  regular_taxable_income: number;
  modified_taxable_income: number;
  beat_base_tax: number;
  payment_types: BeatPaymentType[];
  by_account: BeatAccountRow[];
  schedule_m: BeatScheduleMRow[];
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

// ----------------- VAT / indirect-tax impact (OTP-19) -----------------

/** A single recipient-jurisdiction VAT line over the real IC flows. The base is
 *  live from supply_chain; the standard rate + recoverability flag are seeded. */
export interface VatRow {
  id: string;
  jurisdiction: string;
  country: string;
  regime: string;
  royalty_base: number;
  service_base: number;
  goods_base: number;
  base: number;
  rate: number;
  recoverable_flag: boolean;
  vat_charged: number;
  recoverable: number;
  net_cost: number;
  basis: string;
}

export interface VatTotals {
  jurisdictions: number;
  base: number;
  vat_charged: number;
  recoverable: number;
  net_cost: number;
}

export interface VatModel {
  /** Always true — the rate matrix + recoverability flags are an illustrative seed. */
  fabricated: boolean;
  rows: VatRow[];
  totals: VatTotals;
}

// ----------------- Treasury (IC loans / cash pool — OTP-6 / OTP-13 / OTP-14) -----------------

/** A single intercompany loan from the lender (3400) to an operating entity.
 *  FABRICATED register — no loan source exists in the warehouse. */
export interface TreasuryLoan {
  loan_id: string;
  borrower: string;
  borrower_name: string;
  principal: number;
  currency: string;
  tenor_years: number;
  credit_rating: string;
  base_rate: number;
  credit_spread: number;
  all_in_rate: number;
  /** Computed: principal x all_in_rate. */
  annual_interest: number;
  /** all_in_rate inside the BM-FIN band. */
  within_benchmark: boolean;
}

export interface TreasuryPoolSeat {
  rbukrs: string;
  name: string;
  /** Positive = surplus deposited; negative = drawn from the pool. */
  balance: number;
  position: 'deposit' | 'borrow';
  spread: number;
  /** Computed: balance x spread. */
  annual_interest: number;
}

export interface TreasuryCashPool {
  pool_id: string;
  header: string;
  header_name: string;
  currency: string;
  deposit_spread: number;
  borrow_spread: number;
  /** Σ balances — nets to ~0 by construction. */
  net_position: number;
  participants: TreasuryPoolSeat[];
}

export interface TreasuryTotals {
  loans: number;
  loan_principal: number;
  loan_interest: number;
  loans_within_benchmark: number;
  pool_participants: number;
  pool_net_position: number;
  pool_interest: number;
}

export interface TreasuryModel {
  /** Always true — the register/pool are fabricated, flagged for the user. */
  fabricated: boolean;
  lender: string;
  lender_name: string;
  benchmark_id: string;
  benchmark: { lower: number; median: number; upper: number };
  loans: TreasuryLoan[];
  cash_pool: TreasuryCashPool;
  totals: TreasuryTotals;
}

// ----------------- Data catalog + provenance (OTP-49 console — Phase 2c) -----------------

/** Where a catalog entry sits in the stack. */
export type CatalogKind = 'warehouse' | 'state' | 'seed' | 'parameter';

/** real = verifiable warehouse figure, assumed = illustrative input,
 *  fabricated = magnitude invented for the demo. */
export type Provenance = 'real' | 'assumed' | 'fabricated';

/** One governed data source — a warehouse view, SQLite table, reference seed,
 *  or calc parameter — with its provenance and downstream lineage. */
export interface CatalogEntry {
  id: string;
  kind: CatalogKind;
  name: string;
  description: string | null;
  provenance: Provenance | null;
  lineage: string | null;
}

export type Catalog = CatalogEntry[];

/** A trimmed catalog entry inside a provenance bucket (deep-link target). */
export interface ProvenanceItem {
  id: string;
  kind: CatalogKind;
  name: string;
}

export interface ProvenanceBucket {
  count: number;
  items: ProvenanceItem[];
}

/** Every source + parameter grouped by provenance, with counts + a total. */
export interface ProvenanceRollup {
  buckets: Record<Provenance, ProvenanceBucket>;
  total: number;
}

// ----------------- Calc Studio (calculation registry + run console — CS-a/CS-b) -----------------

/** What a registered calculation does with its inputs ('expression' = a
 *  user-authored formula run by the safe expression engine — W3/W4). */
export type CalcType =
  | 'allocation' | 'derivation' | 'aggregate' | 'band-test' | 'reconciliation' | 'expression';

/** One declared handler argument (merged over by POST /api/calcs/{id}/run args). */
export interface CalcArgSpec {
  type: string;
  default: unknown;
}

/** One raw trace step collected during a run ({"step": "param" | "aggregate" |
 *  "allocate" | "band", ...detail}) — shaped into a tree in CS-d. */
export interface TraceStep {
  step: string;
  [detail: string]: unknown;
}

/** One persisted calculation run (state/calc_runs.py). The output body is
 *  never stored — only its sha256 digest + the seed's summary_keys extract. */
export interface CalcRun {
  id: number;
  calc_id: string;
  actor: string;
  ts: string;
  scenario_id: string | null;
  status: 'succeeded' | 'failed';
  duration_ms: number | null;
  output_digest: string | null;
  error: string | null;
  overrides: Record<string, unknown> | null;
  args: Record<string, unknown> | null;
  summary: Record<string, unknown> | null;
  params_read: TraceStep[];
  trace: TraceStep[];
  /** Derived (CS-c): did the run's overrides intersect the params it read? */
  scenario_sensitive: boolean;
}

/** POST /api/calcs/{id}/run — the persisted run row plus the (unstored) output
 *  body and the shaped explain-steps (CS-d — fresh runs shape with the full
 *  output, the richest trace). */
export interface CalcRunResult extends CalcRun {
  output: unknown;
  shaped_trace: ShapedStep[];
}

/** One registry entry (seeds/calculations/calculations.v1.json) — what the
 *  calculation computes (formula), what it reads (inputs resolve against the
 *  catalog + parameter store) and how the runner invokes it. */
export interface CalcDef {
  id: string;
  name: string;
  type: CalcType;
  /** Seed definition ("system") vs user-authored expression ("user-defined" — W3/W4). */
  kind: 'system' | 'user-defined';
  process_id: string;
  owner: string;
  status: string;
  version: string;
  description: string;
  formula: string;
  inputs: { catalog: string[]; parameters: string[] };
  output: string;
  /** null for user-defined calcs — they run via the expression engine, not HTTP. */
  endpoint: string | null;
  args: Record<string, CalcArgSpec>;
  summary_keys: string[];
  scenario_capable: boolean;
  /** Attached by GET /api/calcs — the most recent run, or null if never run. */
  last_run?: CalcRun | null;
}

/** GET /api/calcs/{id} — the definition with each catalog input attached as
 *  its full catalog entry and each parameter key as its governed row. */
export interface CalcDefResolved extends CalcDef {
  resolved_inputs: {
    catalog: CatalogEntry[];
    parameters: Parameter[];
  };
  last_run: CalcRun | null;
}

// ----------------- Shaped traces + lineage graph (Calc Studio CS-d) -----------------

/** One governed parameter read inside a shaped trace step (the `overridden`
 *  flag marks a scenario-overlay value). */
export interface ShapedStepParam {
  key: string;
  value: unknown;
  overridden: boolean;
}

/** One explain-step of a shaped trace (services/calc_traces.py) — curated for
 *  csa/profit_split/beat, generic Inputs → Output for the rest. `sources` are
 *  catalog ids from the definition's inputs (always resolvable). */
export interface ShapedStep {
  id: string;
  label: string;
  formula: string;
  params: ShapedStepParam[];
  values: Record<string, unknown>;
  sources: string[];
}

/** GET /api/runs/{id}?shaped=true — the persisted run plus its shaped trace
 *  (historical runs shape retroactively from summary + raw trace). */
export interface CalcRunShaped extends CalcRun {
  shaped_trace: ShapedStep[];
}

export type CalcGraphNodeKind = 'source' | 'parameter' | 'calculation' | 'process';

/** One node of the dependency DAG (GET /api/calcs/graph): column 0 sources,
 *  1 parameters, 2 calculations, 3 processes. Provenance is null for the
 *  calculation/process columns. */
export interface CalcGraphNode {
  id: string;
  kind: CalcGraphNodeKind;
  label: string;
  provenance: Provenance | null;
  column: number;
}

export interface CalcGraphEdge {
  from: string;
  to: string;
}

/** The dependency DAG assembled from the registry seed — sources |
 *  parameters | calculations | processes. */
export interface CalcGraph {
  nodes: CalcGraphNode[];
  edges: CalcGraphEdge[];
}

// ----------------- Model Canvas cockpit graph (Phase 7 MC1/MC2) -----------------
//
// The cockpit's editable graph (NOT the read-only dependency DAG above). It is
// a visual layer over backend/calc/expr.py: a calc subgraph compiles to an
// expression string, so the whole governance stack (validate/preview/trace/
// scenario/lifecycle) is reused unchanged. Shapes mirror backend/calc/graph.py.

/** Output kind of a node's value handle. ``null`` = the terminal output node
 *  (it holds no value of its own). */
export type CockpitHandleKind = 'value' | 'bool' | null;

/** One typed input handle of a node type (from GET /api/calc-graph/node-types). */
export interface CockpitInputHandle {
  handle: string;
  kind: CockpitHandleKind;
}

/** One calc-value node type's handle/config schema (the palette catalogue). */
export interface CockpitNodeType {
  type: string;
  family: 'calc';
  /** Fixed input handles, or 'variadic' for func nodes (in0,in1,…). */
  inputs: CockpitInputHandle[] | 'variadic';
  output: CockpitHandleKind;
  config: string[];
}

/** One measure table in the palette (same allowlist validate/preview enforce). */
export interface CockpitMeasureMeta {
  table: string;
  catalog_id: string;
  measures: string[];
  grains: Record<string, string[]>;
  filters: Record<string, 'str' | 'int'>;
}

/** One governed parameter offered as a palette node (live value from the store). */
export interface CockpitParamMeta {
  key: string;
  value: unknown;
  type: string | null;
  category: string | null;
  unit: string | null;
}

/** One composable system calc offered as a palette node. */
export interface CockpitCalcMeta {
  id: string;
  name: string | null;
  process_id: string | null;
}

/** One allocation STAGE node type (Phase 7 MC3) — the typed cost-to-charge
 *  pipeline. ``flow_in``/``flow_out`` are the pipeline (source→…→recon) handles;
 *  ``value_inputs`` are the numeric handles a calc-value subgraph may feed
 *  (e.g. markup.pct); ``config`` is the authoring slice the stage owns. */
export interface CockpitStageType {
  type: string;
  family: 'alloc';
  flow_in: boolean;
  flow_out: boolean;
  value_inputs: string[];
  config: string[];
}

/** GET /api/calc-graph/node-types — the whole palette catalogue. */
export interface CockpitNodeTypes {
  node_types: CockpitNodeType[];
  operators: string[];
  comparators: string[];
  functions: string[];
  grains: string[];
  measures: CockpitMeasureMeta[];
  parameters: CockpitParamMeta[];
  calcs: CockpitCalcMeta[];
  non_composable: string[];
  /** The allocation stage family (MC3) + its canonical order. */
  stage_types: CockpitStageType[];
  stage_order: string[];
  /** The dataset / data-prep family (Phase 8 DS2/DS3) — the source/filter/
   *  aggregate/join/union/derive/select node types + the ACTIVE authored
   *  datasets offered as ``dataset/{id}`` sources. */
  dataset_node_types: DatasetNodeType[];
  dataset_sources: DatasetSource[];
}

// ----------------- Dataset / data-prep layer (Phase 8) -----------------

/** One dataset / data-prep node type (relation handles, distinct family). The
 *  compiler in calc/dataset.py is the single source of truth for the config
 *  shape; this mirrors it so the palette never offers a node the compiler would
 *  reject. ``ops``/``funcs``/``hows`` carry the allowed predicate ops / aggregate
 *  functions / join types for the matching node type. */
export interface DatasetNodeType {
  type: 'source' | 'filter' | 'aggregate' | 'join' | 'union' | 'derive' | 'select';
  family: 'dataset';
  inputs: number;
  output: 'relation';
  config: string[];
  ops?: string[];
  funcs?: string[];
  hows?: string[];
}

/** One source column (role + SQL type) in the dataset palette. ``group`` is the
 *  DS5 UI grouping label (e.g. "Account", "Cost & profit center"). */
export interface DatasetSourceColumn {
  name: string;
  role: 'dimension' | 'measure';
  type: string;
  /** DS5 — the field's display group (additive). */
  group?: string;
}

/** One draggable source FIELD (DS5) — the grouped, provenance-tagged field the
 *  palette renders as a chip you can drag onto the canvas. */
export interface DatasetSourceField {
  name: string;
  role: 'dimension' | 'measure';
  type: string;
  group: string;
  provenance: 'real' | 'fabricated' | 'authored';
}

/** One dataset SOURCE — a warehouse view, the fabricated cost lines, or an
 *  ACTIVE authored dataset (``dataset/{id}``). ``provenance`` distinguishes real
 *  warehouse data from the fabricated seed and authored datasets. */
export interface DatasetSource {
  table: string;
  view: string | null;
  label: string;
  provenance: 'real' | 'fabricated' | 'authored';
  catalog_id: string;
  columns: DatasetSourceColumn[];
  /** DS5 — the grouped, draggable field list (additive over ``columns``). */
  fields: DatasetSourceField[];
  measures: string[];
  join_keys: string[];
  dimensions: string[];
  /** DS5 — the actual distinct VALUES of each value-enumerable low-cardinality
   *  dimension (col -> capped value list); high-cardinality fields are absent. */
  values: Record<string, (string | number)[]>;
  /** Present only for authored-dataset sources. */
  dataset_id?: string;
}

/** GET /api/dataset/sources — the dataset palette catalogue. */
export interface DatasetSourcesCatalog {
  tables: DatasetSource[];
  datasets: DatasetSource[];
  node_types: DatasetNodeType[];
  filter_ops: string[];
  agg_funcs: string[];
  arith_ops: string[];
  /** The real distinct GL / CC / PC value lists for the journal. */
  journal_distinct: Record<string, (string | number)[]>;
}

/** POST /api/dataset/preview — the tabular preview. */
export interface DatasetPreview {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
}

/** POST /api/dataset/validate — structural + allowlist validation report. */
export interface DatasetValidation {
  ok: boolean;
  errors: { message: string; node_id: string | null }[];
  output_columns: string[];
}

export type AuthoredDatasetStatus = 'draft' | 'tested' | 'in_review' | 'active';

/** One authored dataset record (SQLite authored_datasets) — a saved, governed,
 *  reusable data-prep graph (draft → tested → in_review → active, maker-checker
 *  at dataset:{id}). The ``graph`` is the source of truth (compiles to SQL). */
export interface AuthoredDataset {
  id: string;
  name: string;
  description: string | null;
  graph: CockpitGraph;
  process_id: string | null;
  status: AuthoredDatasetStatus;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string | null;
  tested_graph_hash: string | null;
  tested_at: string | null;
  activated_at: string | null;
  activated_by: string | null;
}

/** POST /api/datasets/{id}/test — the preview plus the (maybe updated) dataset
 *  and whether the test gate now holds. */
export interface AuthoredDatasetTestResult {
  dataset: AuthoredDataset;
  result: DatasetPreview;
  tested: boolean;
}

/** One node of a cockpit graph (position drives the React Flow layout). */
export interface CockpitNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

/** One directed edge (source's output handle -> target's input handle). */
export interface CockpitEdge {
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

/** The editable canvas graph — POST bodies + GET /api/user-calcs/{id}/graph. */
export interface CockpitGraph {
  nodes: CockpitNode[];
  edges: CockpitEdge[];
}

/** One structural validation error from POST /api/calc-graph/validate. */
export interface CockpitGraphError {
  message: string;
  node_id: string | null;
}

/** POST /api/calc-graph/validate — every structural error collected at once. */
export interface CockpitGraphValidation {
  ok: boolean;
  errors: CockpitGraphError[];
  output_id: string | null;
}

/** Per-node value painted by POST /api/calc-graph/preview (a node whose
 *  subgraph fails carries ok:false + its error instead of a value). */
export interface CockpitNodeValue {
  ok: boolean;
  grain?: string;
  result?: ExprResult;
  expression: string;
  error?: string;
}

/** POST /api/calc-graph/preview — compile + evaluate (traced); the whole-graph
 *  result, a value per node, the raw trace and any per-node exceptions. With
 *  ``overrides`` the whole evaluation runs under the scenario overlay. */
export interface CockpitGraphPreview {
  expression: string;
  result: ExprResult;
  grain: string;
  nodes: Record<string, CockpitNodeValue>;
  trace: TraceStep[];
  exceptions: { node_id: string; message: string; pos: number | null }[];
}

// ----------------- What-if scenarios (Calc Studio CS-c) -----------------

export type ScenarioStatus = 'draft' | 'in_review' | 'promoted' | 'discarded';

/** One what-if scenario (state/scenarios.py) — a named bundle of parameter
 *  overrides overlaid over the governed store for a run, never written to it.
 *  Promotion rides the maker-checker /review queue; every mutation is
 *  hash-chained at record_ref="scenario:{id}". */
export interface Scenario {
  id: string;
  name: string;
  description: string | null;
  overrides: Record<string, unknown>;
  status: ScenarioStatus;
  created_by: string;
  created_at: string;
  updated_at: string | null;
}

/** POST /api/scenarios/{id}/compare — the same calc run twice (governed base
 *  vs scenario overlay) plus the recursive numeric delta (scenario − base)
 *  over matching paths. Both runs persist to the run console. */
export interface ScenarioCompare {
  base: unknown;
  scenario: unknown;
  delta: unknown;
  scenario_sensitive: boolean;
  base_run_id: number;
  scenario_run_id: number;
}

// ----------------- User-authored calculations (Calculation Builder — W3/W4) -----------------

export type UserCalcStatus = 'draft' | 'tested' | 'in_review' | 'active';

/** One user-authored calculation (state/user_calcs.py) — a named expression in
 *  the safe param()/measure()/calc() grammar with a governed lifecycle:
 *  draft → tested (test-run gate) → in_review (maker submits) → active (a
 *  DIFFERENT checker approves in /review). Every mutation is hash-chained at
 *  record_ref="ucalc:{id}"; editing an active calc bumps the version back to
 *  draft. */
export interface UserCalc {
  id: string;
  name: string;
  description: string | null;
  process_id: string | null;
  output_grain: string;
  expression: string;
  status: UserCalcStatus;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string | null;
  tested_expr_hash: string | null;
  tested_at: string | null;
  activated_at: string | null;
  activated_by: string | null;
}

/** One statically-resolved term of an expression (POST /api/user-calcs/validate). */
export type ExprTerm =
  | { kind: 'param'; key: string; pos: number }
  | {
      kind: 'measure';
      ref: string;
      grain: string;
      filters: string | null;
      catalog_id: string;
      pos: number;
    }
  | { kind: 'calc'; calc_id: string; output_key: string; pos: number };

/** POST /api/user-calcs/validate — parse errors are fatal (a single entry);
 *  term errors are COLLECTED so the Builder shows them all at once. */
export interface ExprValidation {
  ok: boolean;
  errors: { message: string; pos: number | null }[];
  terms: ExprTerm[];
}

/** One row of a grained expression result: the grain's key columns (RBUKRS,
 *  ROLE_CODE, …) plus the float value and the *_exact decimal string. */
export interface ExprResultRow {
  value: number;
  value_exact: string;
  [keyCol: string]: unknown;
}

/** An evaluated expression (preview / test run): a scalar (`value` +
 *  `value_exact` for numbers) at 'group' grain, otherwise grained `rows`
 *  (+ totals when every member is numeric). */
export interface ExprResult {
  grain: string;
  value?: unknown;
  value_exact?: string;
  rows?: ExprResultRow[];
  total?: number;
  total_exact?: string;
}

/** POST /api/user-calcs/preview — evaluate without persisting; `trace` is the
 *  raw term-step list (param/measure/aggregate/calc). */
export interface ExprPreview {
  result: ExprResult;
  grain: string;
  trace: TraceStep[];
}

/** POST /api/user-calcs/{id}/test — the updated row (now 'tested') + the
 *  evaluated result and raw trace (NOT persisted; registry runs land in
 *  calc_runs). */
export interface UserCalcTestRun {
  calc: UserCalc;
  result: ExprResult;
  trace: TraceStep[];
}

/** One measure table of the Builder's term-picker allowlist
 *  (GET /api/user-calcs/terms — straight from calc.expr.MEASURE_TABLES, the
 *  same registry validate/preview enforce). */
export interface MeasureTableMeta {
  table: string;
  catalog_id: string;
  measures: string[];
  grains: Record<string, string[]>;
  filters: Record<string, 'str' | 'int'>;
}

/** GET /api/user-calcs/terms — measure allowlist + legal output grains + the
 *  calc ids calc() may not compose (they write ledgers). */
export interface UserCalcTerms {
  grains: string[];
  measures: MeasureTableMeta[];
  non_composable: string[];
}

// ----------------- Governed parameter store (OTP-49 console — Phase 2a) -----------------

/** One governed calc parameter — the single source for a magnitude that used to
 *  be a scattered hardcoded literal. ``value``/``default`` are free-form JSON
 *  (scalar | list | dict). Every edit is hash-chained at record_ref="param:{key}". */
export interface Parameter {
  key: string;
  value: unknown;
  default: unknown;
  type: string | null;
  min_value: number | null;
  max_value: number | null;
  category: string | null;
  process_id: string | null;
  provenance: Provenance | null;
  rationale: string | null;
  unit: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

// ----------------- Allocation engine (Calc Studio Allocations workbench — M7) -----------------
//
// Frontend projections of the engine's API rows. Amount fields are EXACT
// DECIMAL STRINGS straight off the append-only ledgers (never floats —
// docs/allocation/ENGINE-CLAUDE.md); the UI renders them lexically and never
// converts them to IEEE numbers. The authoritative entity shapes live in
// docs/allocation/intercompany-allocation-schema.json (generated backend
// types) — these interfaces only describe what the workbench displays.

export type AllocationRunType = 'budget' | 'actual' | 'trueup';
export type AllocationRunStatus = 'running' | 'succeeded' | 'failed';

/** The run's persisted summary artifact (summary.json) — also returned inline
 *  by POST /api/allocation/runs (failed runs persist no summary artifact). */
export interface AllocationRunSummary {
  run_id: string;
  period: string;
  run_type: AllocationRunType;
  status: string;
  pools?: number;
  charges: number;
  recon_balanced: boolean;
  total_charged_out: string;
  blocks: number;
  warns: number;
  output_hash: string;
  input_snapshot_hash?: string;
}

/** One allocation run record (SPEC §3.2 run table): period, type, the input
 *  snapshot hash (determinism evidence) and the persisted config. */
export interface AllocationRun {
  run_id: string;
  period: string;
  run_type: AllocationRunType;
  engine_version: string;
  schema_version: string;
  input_snapshot_hash: string;
  started_at: string;
  finished_at: string | null;
  status: AllocationRunStatus;
  scope: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  summary: AllocationRunSummary | null;
}

/** One persisted run artifact (doc pack page, exception report, posting file,
 *  lineage index, output hash) — content served by the per-artifact reads. */
export interface AllocationArtifact {
  name: string;
  content_type: string;
  size?: number;
  created_at: string;
}

export interface AllocationRunDetail extends AllocationRun {
  artifacts: AllocationArtifact[];
}

/** One charge ledger row (schema sheet 10_ChargeLedger + run_id). */
export interface AllocationCharge {
  charge_id: string;
  pool_id: string;
  provider_entity_id: string;
  recipient_entity_id: string;
  period: string;
  fiscal_year: string;
  budget_or_actual: 'Budget' | 'Actual' | 'True-up';
  allocation_key_id: string | null;
  allocation_ratio_applied: string | null;
  cost_recovered_amount: string;
  markup_pct_applied: string;
  markup_amount: string;
  gross_charge_amount: string;
  charge_currency: string;
  fx_rate: string;
  fx_rate_type: string;
  fx_rate_date: string;
  vat_gst_treatment: string | null;
  vat_amount: string | null;
  wht_rate: string | null;
  wht_amount: string | null;
  invoice_ref: string | null;
  journal_entry_ref: string | null;
  settlement_ref: string | null;
  true_up_parent_charge_id: string | null;
  posting_date: string | null;
  documentation_ref: string | null;
  run_id: string | null;
}

/** One recon row (sheet 11_Recon): pooled = exclusions + recovered + residual;
 *  Balanced iff the engine-computed residual is exactly zero (V-X1). */
export interface AllocationRecon {
  recon_id: string;
  run_id: string;
  run_timestamp: string;
  period: string;
  pool_id: string;
  provider_entity_id: string;
  total_pooled_cost: string;
  total_exclusions: string;
  total_cost_recovered: string;
  total_markup: string;
  total_charged_out: string;
  unallocated_residual: string;
  true_up_delta: string | null;
  recon_status: 'Balanced' | 'Break';
  break_amount: string | null;
}

/** One fired V-rule on the SPEC §8.4 exception report. */
export interface AllocationException {
  rule_id: string;
  severity: 'BLOCK' | 'WARN';
  message: string;
  objects: string[];
  pool_id: string | null;
  remediation: string;
}

export interface AllocationExceptionReport {
  run_id: string | null;
  period: string | null;
  counts: { BLOCK: number; WARN: number };
  exceptions: AllocationException[];
}

/** One per-stage value-flow summary emitted by the orchestrator (the same
 *  seven SPEC §4 stages the shaped calc trace shows). */
export interface AllocationStageSummary {
  id: string;
  label: string;
  values: Record<string, unknown>;
}

/** POST /api/allocation/runs — the run record plus summary, stage value-flow,
 *  recon rows and the exception report. A FAILED run is a domain outcome, not
 *  an HTTP error: it comes back 200 with status "failed" and the report. */
export interface AllocationRunLaunch extends AllocationRun {
  stage_summaries: AllocationStageSummary[];
  recon: AllocationRecon[];
  exception_report: AllocationExceptionReport;
  artifacts: string[];
}

/** A constituent cost line from the run's persisted lineage index (schema
 *  sheet 1_CostLine; amount_local is an exact decimal string). */
export interface AllocationCostLine {
  cost_line_id: string;
  provider_entity_id: string;
  company_code?: string | null;
  cost_center: string;
  profit_center?: string | null;
  cost_element?: string | null;
  cost_nature?: string | null;
  function?: string | null;
  amount_local: string;
  currency_local: string;
  posting_date?: string | null;
  fiscal_period: string;
  fiscal_year?: string | null;
  flow_type?: string | null;
  charge_method?: string | null;
  traceable_recipient_id?: string | null;
  pass_through_flag?: boolean | null;
  pool_id?: string | null;
  source_document_ref?: string | null;
}

/** GET /api/allocation/charges/{id}/lineage — the charge, its allocation
 *  context and the constituent cost lines (true-up rows drill to their
 *  parent Budget charge instead). */
export interface AllocationChargeLineage {
  charge: AllocationCharge;
  pool_id: string | null;
  charge_kind: string | null;
  key_value_id: string | null;
  true_up_parent_charge_id: string | null;
  line_ids: string[];
  lines: AllocationCostLine[];
}

/** GET /api/allocation/runs/{id}/docs/{pool} — one doc-pack page (SPEC §8.3). */
export interface AllocationDoc {
  run_id: string;
  pool_id: string;
  markdown: string;
}

// Reference-sheet projections (served read-only via /api/reference/allocation_*).

export interface AllocationPool {
  pool_id: string;
  pool_name: string;
  service_line: string;
  service_description: string;
  provider_entity_id: string;
  characterization: string;
  core_or_support: string;
  cost_base_definition: string;
  default_key_id: string;
  direct_charge_flag: boolean;
  documentation_ref?: string | null;
  effective_from: string;
  effective_to?: string | null;
  status: string;
}

export interface AllocationMarkupPolicy {
  markup_policy_id: string;
  pool_id: string;
  jurisdiction: string;
  regime: string;
  markup_pct: string;
  scm_eligibility_basis?: string | null;
  business_judgment_conclusion?: string | null;
  benchmark_study_ref?: string | null;
  effective_from: string;
  effective_to?: string | null;
}

export interface AllocationExclusionRow {
  exclusion_id: string;
  pool_id: string;
  exclusion_type: string;
  exclusion_pct?: string | null;
  exclusion_amount?: string | null;
  basis_rationale: string;
  effective_from: string;
  effective_to?: string | null;
  owner?: string | null;
}

export interface AllocationKeyDef {
  key_id: string;
  key_name: string;
  key_factor: string;
  factor_components?: string | null;
  source_system: string;
  static_or_dynamic: string;
  recompute_frequency?: string | null;
  description?: string | null;
  owner?: string | null;
}

export interface AllocationEntityRow {
  entity_id: string;
  legal_entity_name: string;
  jurisdiction: string;
  functional_currency: string;
  entity_role?: string | null;
  tier?: number | null;
}

/** The reference-seed envelope (/api/reference/{name}). */
export interface AllocationSeed<T> {
  version: string;
  note?: string;
  rows: T[];
}

// ----------------- Allocation Pool Builder (Phase 6 PB2/PB3) -----------------
//
// Authored pools are governed EXPERIMENTS: a user-built cost-to-charge pool
// (cost-capture rule + key + exclusions + markup) run through the REAL Stages
// 1-7 in isolation and flagged `authored`. They NEVER touch the governed
// seeded allocation (cent-exact to the warehouse). All amounts are exact
// decimal strings (no float math — see ../allocationLib.ts).

export type AuthoredPoolStatus = 'draft' | 'tested' | 'in_review' | 'active';

/** A cost-capture rule's optional split (a fraction in (0,1] of each matched
 *  line is pooled). The predicates are OR-within / AND-across dimension lists. */
export interface AuthoredCaptureRule {
  cost_centers?: string[] | null;
  profit_centers?: string[] | null;
  cost_elements?: string[] | null;
  split_pct?: string | null;
  /** The dataset->allocation bridge (Phase 8 DS3): an ACTIVE authored dataset
   *  (cost-line-shaped) supplies the Source-stage cost base instead of the seed
   *  cost lines. When set, the CC/PC/element predicates become an optional
   *  further filter over the dataset's rows. */
  dataset_id?: string | null;
}

/** The allocation key factor — factor values are computed from the warehouse
 *  per beneficiary; the engine recomputes the total (V-K3). */
export interface AuthoredKey {
  key_factor: 'Equal' | 'Revenue' | 'Cost';
}

/** One authored Stage-3 exclusion — exactly one of amount | pct, plus a
 *  basis_rationale (OECD TPG 7.9–7.10). */
export interface AuthoredExclusion {
  type: string;
  amount?: string | null;
  pct?: string | null;
  basis_rationale: string;
}

/** One authored per-jurisdiction markup policy — a missing policy for a
 *  beneficiary jurisdiction BLOCKS at Stage 5 (V-M1), never defaulted. */
export interface AuthoredMarkupPolicy {
  jurisdiction: string;
  regime: string;
  markup_pct: string;
  benchmark_study_ref?: string | null;
}

/** The user-built authoring object (validate_definition is the single source
 *  of truth for its shape). */
export interface AuthoredPoolDefinition {
  name: string;
  provider_entity_id: string;
  service_line: string;
  characterization: string;
  cost_base_definition: string;
  cost_capture_rule: AuthoredCaptureRule;
  beneficiaries: string[];
  key: AuthoredKey;
  exclusions: AuthoredExclusion[];
  markup_policies: AuthoredMarkupPolicy[];
}

/** One authored pool record (SQLite authored_pools). */
export interface AuthoredPool {
  id: string;
  name: string;
  definition: AuthoredPoolDefinition;
  process_id: string | null;
  status: AuthoredPoolStatus;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string | null;
  tested_def_hash: string | null;
  tested_at: string | null;
  activated_at: string | null;
  activated_by: string | null;
  /** The canvas stage graph (Phase 7 MC3) when authored on the canvas, else
   *  null (a hand-authored pool has no canonical stage layout). */
  graph_json?: CockpitGraph | null;
}

/** GET /api/allocation/dimensions — distinct cost_center / profit_center /
 *  cost_element values across the cost lines, each with its TOTAL cost. */
export interface AllocationDimensionOption {
  value: string;
  total_cost: string;
}
export interface AllocationDimensions {
  source: string;
  cost_centers: AllocationDimensionOption[];
  profit_centers: AllocationDimensionOption[];
  cost_elements: AllocationDimensionOption[];
}

/** POST /api/allocation/pools/preview — the live capture-rule preview card. */
export interface CapturePreview {
  captured_amount: string;
  line_count: number;
  by_entity: Record<string, string>;
}

/** One fired V-rule from a dry-run / authored run. The engine-internal dry-run
 *  exceptions carry no `remediation` (only the persisted run report does). */
export interface AuthoredException {
  rule_id: string;
  severity: 'BLOCK' | 'WARN';
  message: string;
  objects: string[];
  pool_id: string | null;
  remediation?: string;
}

/** A dry-run recon row (Stages 1-7 in isolation) — the persisted-run fields
 *  minus recon_id / run_id / run_timestamp. */
export interface AuthoredReconRow {
  pool_id: string;
  provider_entity_id: string;
  period: string;
  total_pooled_cost: string;
  total_exclusions: string;
  total_cost_recovered: string;
  total_markup: string;
  total_charged_out: string;
  unallocated_residual: string;
  true_up_delta: string | null;
  recon_status: 'Balanced' | 'Break';
  break_amount: string | null;
}

/** One raw dry-run trace step ({step, ...detail}) from the contextvar
 *  collector — sparse value-flow summaries, not a shaped trace. */
export interface AuthoredTraceStep {
  step: string;
  [key: string]: unknown;
}

/** The dry-run result — Stages 1-7 in isolation, nothing persisted. */
export interface AuthoredDryRun {
  pool_id: string;
  periods: string[];
  charges: AllocationCharge[];
  recon: AuthoredReconRow[];
  exceptions: AuthoredException[];
  trace: AuthoredTraceStep[];
  balanced: boolean;
  total_charged_out: string;
}

/** POST /api/allocation/pools/{id}/test — the dry-run plus the (maybe updated)
 *  pool and whether the test gate now holds. */
export interface AuthoredTestResult {
  pool: AuthoredPool;
  dry_run: AuthoredDryRun;
  tested: boolean;
}

/** Per-stage result painted onto a stage node (Phase 7 MC3) — a loose bag keyed
 *  on the stage node id; each stage exposes its own summary fields (captured
 *  amount, exclusions, recipients, markup, charges, balanced/residual). */
export type StagePreviewResult = Record<string, unknown>;

/** POST /api/allocation/pools/preview-graph — compile a stage graph + dry-run it
 *  (Stages 1-7 in isolation, nothing persists). ``stages`` maps each stage node
 *  id to its result; ``ok:false`` carries the stage-order validation errors. */
export interface StageGraphPreview {
  ok: boolean;
  errors?: CockpitGraphError[];
  stages: Record<string, StagePreviewResult>;
  balanced: boolean;
  charges: AllocationCharge[];
  recon: AuthoredReconRow[];
  exceptions: AuthoredException[];
  trace?: AuthoredTraceStep[];
  total_charged_out?: string;
  periods?: string[];
}

/** POST /api/allocation/authored-runs — a persisted authored run (flagged
 *  authored). A failed run is a domain outcome (200, status "failed"). */
export interface AuthoredRunResult extends AllocationRun {
  summary: AllocationRunSummary & { authored?: boolean; authored_pool_ids?: string[] };
  recon: AllocationRecon[];
  exception_report: AllocationExceptionReport;
  artifacts: string[];
}

// ----------------- TP waterfall + post-charge P&L (Phase 5 W1/W2) -----------------
//
// The waterfall orchestrator (services/waterfall_runner.py) applies the
// intercompany charge sequence to the append-only pl_overlays ledger.
// Overlay amounts are EXACT DECIMAL STRINGS off the ledger (never floats);
// base / post-charge P&L measures are floats like every other P&L endpoint.

export type WaterfallRunStatus =
  | 'running'
  | 'applied'
  | 'failed'
  | 'rolled_back'
  | 'superseded';

/** One step's persisted summary on a waterfall run (extra step-specific
 *  detail keys — billing_periods, pool, key, … — ride along untyped). */
export interface WaterfallStep {
  id: string;
  status: string;
  label?: string;
  lines?: number;
  /** Exact decimal strings — Σ revenue-side / Σ cost-side / net (== "0"). */
  revenue_total?: string;
  cost_total?: string;
  net?: string;
  error?: string;
  billing_periods?: string[];
  allocation_run_ids?: string[];
  [extra: string]: unknown;
}

export interface WaterfallRun {
  id: string;
  year: number;
  actor: string;
  status: WaterfallRunStatus;
  steps: WaterfallStep[];
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

/** One append-only overlay ledger line (a reversing row has a negative
 *  amount and reverses_id -> the original line). */
export interface PlOverlayLine {
  id: number;
  waterfall_run_id: string;
  step: string;
  entity: string;
  function: string | null;
  period: string;
  line_kind: string;
  side: 'revenue' | 'cost';
  /** Exact decimal string. */
  amount: string;
  source_ref: string;
  reverses_id: number | null;
  created_at: string;
}

export interface WaterfallRunDetail extends WaterfallRun {
  lines: PlOverlayLine[];
}

/** Per-kind overlay rollup — exact decimal strings. */
export interface PlOverlayKindTotals {
  revenue: string;
  cost: string;
  net: string;
}

/** One row of GET /api/pl/adjusted: base segment_pl aggregate | applied
 *  overlay | post-charge totals, with per-line provenance. */
export interface PlAdjustedRow {
  entity: string;
  function: string | null;
  base: {
    revenue: number;
    operating_profit: number;
    operating_margin: number | null;
    [measure: string]: number | null;
  };
  overlay: PlOverlayKindTotals & {
    by_kind: Record<string, PlOverlayKindTotals>;
  };
  post_charge: {
    revenue: number;
    ic_cost: number;
    operating_profit: number;
    operating_margin: number | null;
  };
  lines: PlOverlayLine[];
}

export interface PlAdjusted {
  year: number;
  grain: 'entity' | 'entity_function';
  /** The currently applied waterfall run — null = post-charge == base. */
  applied_run_id: string | null;
  rows: PlAdjustedRow[];
  totals: {
    overlay_revenue: string;
    overlay_cost: string;
    overlay_net: string;
  };
}

/** A waterfall apply/rollback REQUEST (GP4). The waterfall rewrites the group
 *  P&L, so running / rolling it back submits one of these for maker-checker
 *  review instead of executing; a DIFFERENT reviewer approving the enqueued
 *  waterfall:{id} item is what actually runs it (execute-on-approve). */
export type WaterfallRequestStatus = 'pending' | 'approved' | 'rejected';

export interface WaterfallRequest {
  id: string;
  action: 'run' | 'rollback';
  year: number;
  /** The applied run to reverse (action === 'rollback'). */
  target_run_id: string | null;
  /** Ordered step subset for a run; null = the full default sequence. */
  steps: string[] | null;
  status: WaterfallRequestStatus;
  rationale: string | null;
  requested_by: string;
  /** The WF-* run produced (run) / reversed (rollback) once approved. */
  executed_run_id: string | null;
  /** The audit / review ref this request lives at — "waterfall:{id}". */
  record_ref: string;
  created_at: string;
  decided_at: string | null;
}

/** P&L basis selector for the margin-bearing reads (W2). Omitted = the
 *  governed pl.use_post_charge parameter resolves it server-side. */
export type PlBasis = 'base' | 'post_charge';

// ---------------- Close Command Center (GET /api/close/status) ----------------

/** The P&L basis the platform is reporting on right now. */
export interface CloseBasis {
  mode: PlBasis;
  /** The governed pl.use_post_charge parameter. */
  param_on: boolean;
  /** The applied waterfall run — null = no charges applied. */
  applied_run_id: string | null;
}

export type CloseStepId =
  | 'master_data'
  | 'price_setting'
  | 'charges'
  | 'waterfall'
  | 'monitor'
  | 'adjust'
  | 'review'
  | 'document';

export type CloseStepStatus = 'complete' | 'active' | 'attention' | 'pending';

/** One step of the ordered 8-step close sequence. */
export interface CloseStep {
  id: CloseStepId;
  label: string;
  status: CloseStepStatus;
  owner: 'operator' | 'reviewer' | 'director' | 'shared';
  route: string;
  /** All ints — booleans are encoded 1/0 (the raw bool lives in `basis`). */
  counts: Record<string, number>;
  /** One human sentence summarising where the step stands. */
  detail: string;
}

export interface CloseStatus {
  year: number;
  basis: CloseBasis;
  /** Index of the first non-complete step (the last step once all complete). */
  current_index: number;
  steps: CloseStep[];
}
