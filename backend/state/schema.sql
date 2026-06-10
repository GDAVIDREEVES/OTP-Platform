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
