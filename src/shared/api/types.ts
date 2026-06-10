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

/** One row in the unified worklist / Inbox — a cross-process "what's on my
 *  plate" feed aggregating drafts, review items, OTP-20 exceptions, and open
 *  cases. Read-only: `route` deep-links back to the owning work surface. */
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

/** What a registered calculation does with its inputs. */
export type CalcType = 'allocation' | 'derivation' | 'aggregate' | 'band-test' | 'reconciliation';

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

/** POST /api/calcs/{id}/run — the persisted run row plus the (unstored) output body. */
export interface CalcRunResult extends CalcRun {
  output: unknown;
}

/** One registry entry (seeds/calculations/calculations.v1.json) — what the
 *  calculation computes (formula), what it reads (inputs resolve against the
 *  catalog + parameter store) and how the runner invokes it. */
export interface CalcDef {
  id: string;
  name: string;
  type: CalcType;
  process_id: string;
  owner: string;
  status: string;
  version: string;
  description: string;
  formula: string;
  inputs: { catalog: string[]; parameters: string[] };
  output: string;
  endpoint: string;
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
