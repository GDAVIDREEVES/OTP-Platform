-- OTP Platform — SQLite state schema. Idempotent; safe to run on every boot.

-- Append-only, hash-chained audit stream. One row per state change anywhere
-- in the platform. Written only through state/audit.py:record().
CREATE TABLE IF NOT EXISTS audit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,                       -- ISO-8601 UTC
  actor       TEXT NOT NULL,                       -- user id, or "research-brain"
  actor_kind  TEXT NOT NULL CHECK (actor_kind IN ('human', 'assistant')),
  process_id  TEXT,                                -- e.g. "OTP-16" (nullable for global)
  record_ref  TEXT NOT NULL,                       -- e.g. "adj:ADJ-1A2B", "RBUKRS:3300"
  event_type  TEXT NOT NULL,                       -- created|edited|submitted|reviewed|approved|rejected|posted|reversed|prepared
  before_json TEXT,
  after_json  TEXT,
  rationale   TEXT,                                -- captured at the point of action
  prev_hash   TEXT NOT NULL,                       -- hash of the previous row (genesis = 64 zeros)
  hash        TEXT NOT NULL                        -- sha256(prev_hash + canonical(payload))
);
CREATE INDEX IF NOT EXISTS ix_audit_record ON audit_events (record_ref);
CREATE INDEX IF NOT EXISTS ix_audit_process ON audit_events (process_id);

-- Per-user, per-record workflow drafts (autosave + leave-and-return).
CREATE TABLE IF NOT EXISTS process_drafts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  process_id  TEXT NOT NULL,
  record_ref  TEXT NOT NULL,
  step        TEXT NOT NULL,
  step_index  INTEGER NOT NULL DEFAULT 0,
  payload     TEXT NOT NULL DEFAULT '{}',          -- JSON working state
  status      TEXT NOT NULL DEFAULT 'in_progress', -- in_progress|submitted|abandoned
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (user_id, process_id, record_ref)
);

-- Users and their single role. No real auth in the demo; the active user is
-- selected via the X-OTP-User header and seeded from seeds/users.
CREATE TABLE IF NOT EXISTS users (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  title TEXT,
  role  TEXT NOT NULL CHECK (role IN ('operator', 'reviewer', 'director')),
  email TEXT
);

-- Maker-checker review queue.
CREATE TABLE IF NOT EXISTS review_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  process_id  TEXT NOT NULL,
  record_ref  TEXT NOT NULL,
  maker       TEXT NOT NULL,
  checker     TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  comments    TEXT,
  created_at  TEXT NOT NULL,
  decided_at  TEXT
);

-- App state migrated from the old JSON store. Records keep their flexible
-- shape as JSON in `data`; hot columns are promoted for querying.
CREATE TABLE IF NOT EXISTS adjustments (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,          -- full JSON record
  status     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS policy_overrides (
  flow_id    TEXT PRIMARY KEY,
  data       TEXT NOT NULL,          -- full JSON record
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- Tracks which seed file versions have been loaded (version-gated reseed).
CREATE TABLE IF NOT EXISTS seed_versions (
  seed      TEXT PRIMARY KEY,
  version   TEXT NOT NULL,
  loaded_at TEXT NOT NULL
);

-- ---- Master data: editable TP overlay + inbound mapping staging ----

CREATE TABLE IF NOT EXISTS md_entity_function (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  rbukrs           TEXT NOT NULL,
  tp_function_code TEXT NOT NULL,
  is_primary       INTEGER NOT NULL DEFAULT 0,
  tested_party     INTEGER NOT NULL DEFAULT 0,
  applies_to       TEXT,                              -- JSON array of categories
  status           TEXT NOT NULL DEFAULT 'active',    -- active|retired
  created_at       TEXT NOT NULL,
  updated_at       TEXT
);
CREATE INDEX IF NOT EXISTS ix_md_ef_rbukrs ON md_entity_function (rbukrs);

CREATE TABLE IF NOT EXISTS md_overlay (
  ctx_id          TEXT PRIMARY KEY,
  policy_ref      TEXT,
  ica_ref         TEXT,
  apa_ref         TEXT,
  target_override REAL,
  notes           TEXT,
  updated_by      TEXT,
  updated_at      TEXT
);

CREATE TABLE IF NOT EXISTS md_staging (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,                        -- entity|account|transaction|field
  raw_json      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'unmapped',     -- unmapped|proposed|in_review|applied|rejected
  proposed_json TEXT,
  confidence    TEXT,
  rationale     TEXT,
  maker         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS md_mapping (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  kind           TEXT NOT NULL,
  raw_key        TEXT NOT NULL,
  canonical_json TEXT NOT NULL,
  applied_by     TEXT,
  applied_at     TEXT NOT NULL
);

-- Governance cases (Case Workspace — OTP-30/31/40/50): controversy, restructuring,
-- and integration matters with status, owner, due date, checklist + audit trail.
CREATE TABLE IF NOT EXISTS cases (
  id             TEXT PRIMARY KEY,
  process_id     TEXT NOT NULL,
  kind           TEXT NOT NULL,
  title          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','submitted','closed')),
  owner          TEXT NOT NULL,
  counterparty   TEXT,
  jurisdiction   TEXT,
  exposure       REAL,
  opened_at      TEXT NOT NULL,
  due_at         TEXT,
  checklist_json TEXT NOT NULL DEFAULT '[]',
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT
);
CREATE INDEX IF NOT EXISTS ix_cases_process ON cases (process_id);

-- Governed parameter store (OTP-49 console / Phase 2a). One row per calc
-- parameter pulled out of router code into a single auditable registry. `value`
-- and `default_value` are JSON-encoded so a row can hold a scalar, a list, or a
-- dict. Every edit is hash-chained at record_ref="param:{key}" (see
-- state/parameters.py:set_param) — so each parameter's Audit tab + evidence
-- packet light up with no extra wiring.
CREATE TABLE IF NOT EXISTS parameters (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL,    -- JSON-encoded current value (scalar|list|dict)
  type          TEXT,             -- declared value type: number|string|list|dict|bool
  default_value TEXT,             -- JSON-encoded governed default (for reset)
  min_value     REAL,
  max_value     REAL,
  category      TEXT,
  process_id    TEXT,
  provenance    TEXT,             -- real|assumed|fabricated
  rationale     TEXT,
  unit          TEXT,
  updated_at    TEXT,
  updated_by    TEXT
);
CREATE INDEX IF NOT EXISTS ix_parameters_category ON parameters (category);

-- Calculation run history (Calc Studio CS-a). One row per registry run
-- (services/calc_registry.py:run()): who ran which calc with which args, the
-- sha256 digest + summary of the output (the full output body is NOT persisted
-- — reconciliation alone is ~135KB), the parameters read and the raw trace
-- collected via calc/trace.py. Runs are also hash-chained into the audit
-- stream at record_ref="calc:{calc_id}" (event_type "run").
CREATE TABLE IF NOT EXISTS calc_runs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  calc_id          TEXT NOT NULL,
  actor            TEXT NOT NULL,
  ts               TEXT NOT NULL,                     -- ISO-8601 UTC
  scenario_id      TEXT,                              -- scenario run (CS-c); NULL = base
  overrides_json   TEXT,                              -- JSON {param_key: value} snapshot (CS-c)
  args_json        TEXT,                              -- JSON kwargs the handler ran with
  status           TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  duration_ms      INTEGER,
  output_digest    TEXT,                              -- sha256 over the canonical output JSON
  summary_json     TEXT,                              -- JSON {summary_key: value} for the Runs table
  params_read_json TEXT,                              -- JSON list of "param" trace events
  trace_json       TEXT,                              -- JSON list of raw trace steps
  error            TEXT                               -- failure message (status = failed)
);
CREATE INDEX IF NOT EXISTS ix_calc_runs_calc ON calc_runs (calc_id);

-- What-if scenarios (Calc Studio CS-c). A scenario is a named bundle of
-- parameter overrides ({param_key: value} in overrides_json) that a run can
-- overlay over the governed store without ever writing it. Promotion rides
-- the existing maker-checker queue: submit -> in_review -> approve applies
-- each override via state/parameters.py:set_param (audited at param:{key})
-- and marks the scenario promoted; reject returns it to draft. Every mutation
-- is hash-chained at record_ref="scenario:{id}" (see state/scenarios.py).
CREATE TABLE IF NOT EXISTS scenarios (
  id             TEXT PRIMARY KEY,                  -- "SC-1", "SC-2", ...
  name           TEXT NOT NULL,
  description    TEXT,
  overrides_json TEXT NOT NULL DEFAULT '{}',        -- JSON {param_key: value}
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','promoted','discarded')),
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT
);

-- ==== BEGIN GENERATED ALLOCATION DDL (allocation/codegen.py - do not edit between markers) ====
-- Allocation engine ledgers (docs/allocation/SPEC.md §3). Decimal/Percent
-- columns are TEXT holding exact decimal strings — never floats.

-- 1_CostLine (1. Cost Line (source GL / ACDOCA)) -> cost_lines. Append-only ledger:
-- corrections are reversing rows, never UPDATEs (SPEC §3.1).
CREATE TABLE IF NOT EXISTS cost_lines (
  cost_line_id TEXT PRIMARY KEY,
  provider_entity_id TEXT NOT NULL,
  company_code TEXT NOT NULL,
  cost_center TEXT NOT NULL,
  profit_center TEXT,
  cost_element TEXT NOT NULL,
  cost_nature TEXT NOT NULL,
  function TEXT NOT NULL,
  amount_local TEXT NOT NULL,
  currency_local TEXT NOT NULL,
  posting_date TEXT NOT NULL,
  fiscal_period TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,
  flow_type TEXT NOT NULL,
  charge_method TEXT NOT NULL,
  traceable_recipient_id TEXT,
  pass_through_flag INTEGER NOT NULL CHECK (pass_through_flag IN (0, 1)),
  pool_id TEXT,
  source_document_ref TEXT NOT NULL
);

-- 7_KeyValue (7. Allocation Key Value (per recipient, per period)) -> key_values. Append-only ledger:
-- corrections are reversing rows, never UPDATEs (SPEC §3.1).
CREATE TABLE IF NOT EXISTS key_values (
  key_value_id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  recipient_entity_id TEXT NOT NULL,
  period TEXT NOT NULL,
  factor_value TEXT NOT NULL,
  total_factor_value TEXT NOT NULL,
  allocation_ratio TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  source_ref TEXT
);

-- 10_ChargeLedger (10. Charge Ledger (output)) -> charge_ledger. Append-only ledger:
-- corrections are reversing rows, never UPDATEs (SPEC §3.1).
CREATE TABLE IF NOT EXISTS charge_ledger (
  charge_id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL,
  provider_entity_id TEXT NOT NULL,
  recipient_entity_id TEXT NOT NULL,
  period TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,
  budget_or_actual TEXT NOT NULL,
  allocation_key_id TEXT,
  allocation_ratio_applied TEXT,
  cost_recovered_amount TEXT NOT NULL,
  markup_pct_applied TEXT NOT NULL,
  markup_amount TEXT NOT NULL,
  gross_charge_amount TEXT NOT NULL,
  charge_currency TEXT NOT NULL,
  fx_rate TEXT,
  fx_rate_type TEXT,
  fx_rate_date TEXT,
  vat_gst_treatment TEXT,
  vat_amount TEXT,
  wht_rate TEXT,
  wht_amount TEXT,
  invoice_ref TEXT,
  journal_entry_ref TEXT,
  settlement_ref TEXT,
  true_up_parent_charge_id TEXT,
  posting_date TEXT NOT NULL,
  documentation_ref TEXT,
  run_id TEXT
);

-- 11_Recon (11. Reconciliation & Audit Log) -> recon. Append-only ledger:
-- corrections are reversing rows, never UPDATEs (SPEC §3.1).
CREATE TABLE IF NOT EXISTS recon (
  recon_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  run_timestamp TEXT NOT NULL,
  period TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  provider_entity_id TEXT NOT NULL,
  total_pooled_cost TEXT NOT NULL,
  total_exclusions TEXT NOT NULL,
  total_cost_recovered TEXT NOT NULL,
  total_markup TEXT NOT NULL,
  total_charged_out TEXT NOT NULL,
  unallocated_residual TEXT NOT NULL,
  true_up_delta TEXT,
  recon_status TEXT NOT NULL,
  break_amount TEXT
);

-- Run table (SPEC §3.2): period, scope, engine/schema versions, input
-- snapshot hash, timing, status. Config (SPEC §6) persisted with the run.
CREATE TABLE IF NOT EXISTS allocation_runs (
  run_id              TEXT PRIMARY KEY,
  period              TEXT NOT NULL,
  run_type            TEXT NOT NULL CHECK (run_type IN ('budget', 'actual', 'trueup')),
  scope_json          TEXT,
  config_json         TEXT,
  engine_version      TEXT,
  schema_version      TEXT,
  input_snapshot_hash TEXT,
  started_at          TEXT NOT NULL,
  finished_at         TEXT,
  status              TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS ix_cost_lines_provider_period ON cost_lines (provider_entity_id, fiscal_period);
CREATE INDEX IF NOT EXISTS ix_cost_lines_pool ON cost_lines (pool_id);
CREATE INDEX IF NOT EXISTS ix_key_values_pool_period ON key_values (pool_id, period);
CREATE INDEX IF NOT EXISTS ix_charge_ledger_run ON charge_ledger (run_id);
CREATE INDEX IF NOT EXISTS ix_charge_ledger_pool_period ON charge_ledger (pool_id, period);
CREATE INDEX IF NOT EXISTS ix_recon_run ON recon (run_id);
-- ==== END GENERATED ALLOCATION DDL ====

-- Allocation run artifacts (SPEC §8 outputs; M6, ADAPTATION D1). The
-- orchestrator persists each run's documentation pack (Markdown per pool),
-- exception report, posting files, charge->cost-line lineage index, output
-- hash and summary as rows here — SQLite text, not loose files, so a demo
-- reset wipes them with everything else (DECISIONS.md M6). NOT generated:
-- this table is orchestrator infrastructure, not a schema.json sheet.
CREATE TABLE IF NOT EXISTS allocation_run_artifacts (
  run_id       TEXT NOT NULL,
  name         TEXT NOT NULL,     -- 'docs/{pool}.md', 'exceptions.json', ...
  content_type TEXT NOT NULL,     -- 'text/markdown' | 'application/json' | ...
  content      TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (run_id, name)
);

-- P&L overlay ledger (Phase 5 W1 — Author & Apply waterfall). One row per
-- DOUBLE-ENTRY leg of an applied intercompany charge: the provider books a
-- revenue+ line and the recipient a cost+ line for the same amount, so the
-- group always nets to zero. APPEND-ONLY: corrections/rollbacks are reversing
-- rows (negative amount, reverses_id -> the original line), never UPDATEs.
-- `amount` is an exact decimal string (TEXT) — never a float. Every append is
-- hash-chained into the audit trail at record_ref="overlay:{id}" (see
-- state/pl_overlays.py), so each line's evidence packet lights up for free.
CREATE TABLE IF NOT EXISTS pl_overlays (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  waterfall_run_id TEXT NOT NULL,    -- "WF-1", ... (waterfall_runs.id)
  step             TEXT NOT NULL,    -- waterfall step that produced the line
  entity           TEXT NOT NULL,    -- RBUKRS
  function         TEXT,             -- ROLE_CODE | NULL (entity_function grain)
  period           TEXT NOT NULL,    -- 'YYYY-MM' (billing period) or 'YYYY'
  line_kind        TEXT NOT NULL CHECK (line_kind IN
                     ('service_charge','royalty','csa_true_up','profit_split','other')),
  side             TEXT NOT NULL CHECK (side IN ('revenue','cost')),
  amount           TEXT NOT NULL,    -- exact decimal string; negative = reversing row
  source_ref       TEXT NOT NULL,    -- provenance: charge/royalty pair/calc ref
  reverses_id      INTEGER,          -- the pl_overlays.id this row reverses
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_pl_overlays_run ON pl_overlays (waterfall_run_id);
CREATE INDEX IF NOT EXISTS ix_pl_overlays_entity ON pl_overlays (entity);

-- User-authored calculations (Phase 5 W3 — Author & Apply Calculation
-- Builder). One row per user-defined expression evaluated by the safe engine
-- in calc/expr.py (tokenizer/AST/Decimal — no eval/exec). Lifecycle:
-- draft -> tested (successful test run of the CURRENT expression; the hash
-- gate below) -> in_review (maker submits; one review item at
-- record_ref="ucalc:{id}") -> active (a DIFFERENT checker approves —
-- state/review.py:decide() hook), mirroring scenario promotion. Editing an
-- active calculation bumps `version` and returns it to draft for re-approval.
-- Every mutation is hash-chained at record_ref="ucalc:{id}"
-- (state/user_calcs.py); registry runs of active calcs land in calc_runs and
-- audit "run" events on the same ref.
CREATE TABLE IF NOT EXISTS user_calculations (
  id               TEXT PRIMARY KEY,                -- "UC-1", "UC-2", ...
  name             TEXT NOT NULL,
  description      TEXT,
  process_id       TEXT,                            -- optional process binding
  output_grain     TEXT NOT NULL DEFAULT 'group' CHECK (output_grain IN ('group','entity','entity_function')),
  expression       TEXT NOT NULL,                   -- source text (calc/expr.py grammar)
  graph_json       TEXT,                            -- Phase 7 MC1: canvas graph (visual layer; expression is source of truth)
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','tested','in_review','active')),
  version          INTEGER NOT NULL DEFAULT 1,
  tested_expr_hash TEXT,                            -- sha256 of expression at last successful test
  tested_at        TEXT,
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT,
  activated_at     TEXT,
  activated_by     TEXT
);

-- Waterfall orchestrator runs (services/waterfall_runner.py). One row per
-- launch of the ordered charge sequence (default service_allocation ->
-- royalties -> csa_true_up -> profit_split); steps_json carries the per-step
-- summary (lines, revenue/cost totals, source refs). Exactly ONE run is
-- 'applied' at a time: applying a new run first reverses the prior applied
-- run's overlay lines and marks it 'superseded'; an explicit rollback marks
-- it 'rolled_back'. Audited at record_ref="waterfall:{id}".
CREATE TABLE IF NOT EXISTS waterfall_runs (
  id          TEXT PRIMARY KEY,      -- "WF-1", "WF-2", ...
  year        INTEGER NOT NULL,
  actor       TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN
                ('running','applied','failed','rolled_back','superseded')),
  steps_json  TEXT NOT NULL DEFAULT '[]',
  error       TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);

-- Waterfall apply/rollback REQUESTS (UX Phase 2 GP4 — governance loop). The
-- waterfall is the platform's highest-impact write (it rewrites the group
-- segmented P&L), so it must not execute on a single click: a run/rollback is
-- first captured here as a PENDING request that enqueues ONE maker-checker item
-- at record_ref="waterfall:{id}". The P&L is untouched until a DIFFERENT
-- reviewer approves the item in the /review queue, at which point
-- state/review.py:decide() calls services/waterfall_runner.py to actually run
-- (or roll back) — the SAME execute-on-approve pattern scenario promotion uses.
-- `executed_run_id` records the WF-* run the approval produced/reversed. Every
-- mutation is hash-chained at record_ref="waterfall:{id}" (state/
-- waterfall_requests.py).
CREATE TABLE IF NOT EXISTS waterfall_requests (
  id              TEXT PRIMARY KEY,                -- "WFR-1", "WFR-2", ...
  action          TEXT NOT NULL CHECK (action IN ('run','rollback')),
  year            INTEGER NOT NULL,
  target_run_id   TEXT,                            -- the WF-* run to roll back (action='rollback')
  steps_json      TEXT,                            -- optional ordered step subset (action='run'); NULL = default sequence
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  rationale       TEXT,
  requested_by    TEXT NOT NULL,
  executed_run_id TEXT,                            -- the WF-* run produced (run) / reversed (rollback) on approval
  created_at      TEXT NOT NULL,
  decided_at      TEXT
);

-- User-authored allocation pools (Phase 6 PB2 — Allocation Pool Builder). One
-- row per user-built cost-to-charge pool: a cost-capture rule (predicates over
-- cost_center / profit_center / cost_element), beneficiaries, an allocation key
-- factor, exclusions and markup policies. The full authoring object lives as
-- JSON in `definition_json`; hot columns are promoted for listing. Lifecycle
-- mirrors user_calculations:
--   draft -> tested (a successful dry-run of the CURRENT definition; the hash
--   gate below) -> in_review (maker submits; one review item at
--   record_ref="allocpool:{id}") -> active (a DIFFERENT checker approves —
--   state/review.py:decide() hook). Editing an active pool bumps `version` and
--   returns it to draft for re-test + re-approval. `tested_def_hash` is the
--   sha256 of the canonical definition JSON at the last successful dry-run, so
--   an untested definition can never reach activation. Authored pools are
--   governed EXPERIMENTS — they overlay the engine in isolation and NEVER touch
--   the governed seeded allocation. Every mutation is hash-chained at
--   record_ref="allocpool:{id}" (state/authored_pools.py).
CREATE TABLE IF NOT EXISTS authored_pools (
  id              TEXT PRIMARY KEY,                -- "AP-1", "AP-2", ...
  name            TEXT NOT NULL,
  definition_json TEXT NOT NULL,                   -- full authoring object (JSON)
  graph_json      TEXT,                            -- Phase 7 MC3: canvas stage graph (visual layer; definition is source of truth)
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','tested','in_review','active')),
  version         INTEGER NOT NULL DEFAULT 1,
  process_id      TEXT,                            -- optional process binding
  tested_def_hash TEXT,                            -- sha256 of definition_json at last successful dry-run
  tested_at       TEXT,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT,
  activated_at    TEXT,
  activated_by    TEXT
);

-- First-class authored datasets (Phase 8 DS2 — Dataset / Data-Prep Layer). One
-- row per user-built data-prep graph (source / filter / aggregate / join / union
-- / derive / select nodes). The graph is the source of truth and lives as JSON
-- in `graph_json`; it compiles to ONE safe parameterized DuckDB query
-- (calc/dataset.py). Lifecycle mirrors authored_pools / user_calculations:
--   draft -> tested (a successful compile+run of the CURRENT graph; the hash
--   gate below) -> in_review (maker submits; one review item at
--   record_ref="dataset:{id}") -> active (a DIFFERENT checker approves —
--   state/review.py:decide() hook). Editing an active dataset bumps `version`
--   and returns it to draft for re-test + re-approval. `tested_graph_hash` is
--   the sha256 of the canonical graph JSON at the last successful test run, so
--   an untested graph can never reach activation. An ACTIVE dataset is
--   referenceable as a SOURCE in another dataset (a `dataset/{id}` source node;
--   calc/dataset.py resolves it as a compiled subquery). Every mutation is
--   hash-chained at record_ref="dataset:{id}" (state/authored_datasets.py).
CREATE TABLE IF NOT EXISTS authored_datasets (
  id                TEXT PRIMARY KEY,              -- "DS-1", "DS-2", ...
  name              TEXT NOT NULL,
  description       TEXT,
  graph_json        TEXT NOT NULL,                 -- the dataset data-prep graph (source of truth)
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','tested','in_review','active')),
  version           INTEGER NOT NULL DEFAULT 1,
  process_id        TEXT,                          -- optional process binding
  tested_graph_hash TEXT,                          -- sha256 of canonical graph_json at last successful test run
  tested_at         TEXT,
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT,
  activated_at      TEXT,
  activated_by      TEXT
);
