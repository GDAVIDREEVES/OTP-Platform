-- GENERATED - do not edit. Rendered by allocation/codegen.py from docs/allocation/intercompany-allocation-schema.json.

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
