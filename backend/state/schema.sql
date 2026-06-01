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
