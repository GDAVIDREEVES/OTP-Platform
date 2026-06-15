"""M1 gate — codegen, persistence, seeds generator (SPEC §10 M1 + ADAPTATION D1/D2).

Covers, in order:
- codegen idempotency: re-rendering from schema.json is byte-identical to the
  committed generated files (types.py, ddl.sql, the schema.sql splice);
- every emitted seed validates against the generated types + enumerations
  (V-R2) and every schema.json FK reference resolves (V-R1);
- the committed seeds are exactly what the generator emits (re-run drift check);
- ledger round-trip insert/list/get through state/allocation_store.py, which is
  append-only by construction (no update/delete API; duplicate PK rejected);
- allocation_runs: insert_run with input_snapshot_hash + status transitions;
- seed reconciliation pre-check: Σ cost_lines per provider equals the warehouse
  SERVICE pair cost base + the stewardship register's flagged exclusions, to
  the cent — Decimal end to end, parquet read directly.

NO float arithmetic on amounts anywhere in this file (ENGINE-CLAUDE.md).

Run from backend/:  ../.venv/bin/python -m pytest tests/allocation/test_m1_roundtrip.py
"""

from __future__ import annotations

import importlib.util
import json
from decimal import Decimal
from pathlib import Path

import duckdb
import pytest

from allocation import codegen, validation
from allocation.generated import types as gen
from config import SUPPLY_CHAIN
from state import allocation_store as store

BACKEND = Path(__file__).resolve().parents[2]
SEED_DIR = BACKEND / "seeds" / "allocation"
CENT = Decimal("0.01")


def _load_generator():
    spec = importlib.util.spec_from_file_location(
        "allocation_generate_seeds", SEED_DIR / "generate_seeds.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _seed_doc(fname: str) -> dict:
    return json.loads((SEED_DIR / fname).read_text(encoding="utf-8"))


GENMOD = _load_generator()


# ------------------------------------------------------------------ codegen --


def test_codegen_idempotent_byte_identical():
    """Re-running codegen reproduces the committed generated files exactly."""
    schema = codegen.load_schema()
    committed_types = (codegen.GENERATED_DIR / "types.py").read_text(encoding="utf-8")
    committed_ddl = (codegen.GENERATED_DIR / "ddl.sql").read_text(encoding="utf-8")
    committed_init = (codegen.GENERATED_DIR / "__init__.py").read_text(encoding="utf-8")
    assert codegen.render_types(schema) == committed_types
    assert codegen.render_ddl(schema) == committed_ddl
    assert codegen.render_init() == committed_init
    # and rendering twice is stable in itself
    assert codegen.render_types(schema) == codegen.render_types(schema)


def test_schema_sql_splice_idempotent():
    """state/schema.sql carries the generated DDL between markers; re-splicing
    the committed file is a byte-identical no-op."""
    schema = codegen.load_schema()
    committed = codegen.SCHEMA_SQL_PATH.read_text(encoding="utf-8")
    assert codegen.BEGIN_MARK in committed and codegen.END_MARK in committed
    assert codegen.splice_schema_sql(committed, codegen.render_ddl_body(schema)) == committed


def test_generated_enums_cover_all_19_enumerations():
    assert len(gen.ENUM_VALUES) == 19
    assert len(gen.ENUMS) == 19
    # spot-check tricky members survive sanitization (V-R2 backing data)
    assert gen.Regime.LVAIGS_5.value == "LVAIGS (5%)"
    assert gen.ScmEligibilityBasis.N_A.value == "n/a"
    assert gen.FunctionServiceLine.R_D_SUPPORT.value == "R&D support"


def test_generated_ddl_covers_ledgers_and_runs_only():
    """Reference sheets (2,3,4,5,6,8,9) are seeds, NOT tables (ADAPTATION D1)."""
    ddl = (codegen.GENERATED_DIR / "ddl.sql").read_text(encoding="utf-8")
    for table in ("cost_lines", "key_values", "charge_ledger", "recon", "allocation_runs"):
        assert f"CREATE TABLE IF NOT EXISTS {table} (" in ddl
    for sheet in ("2_CCMapping", "3_Pool", "4_MarkupPolicy", "5_Exclusions",
                  "6_KeyDef", "8_Entity", "9_Participation"):
        assert gen.ENTITIES[sheet]["table"] is None


# -------------------------------------------------------------------- seeds --


def test_seeds_validate_types_enums_v_r2_and_fk_references_v_r1():
    """Every emitted row conforms to the generated entity shape; every
    schema.json `references` resolves across the seed set (V-R1, V-R2)."""
    docs = {fname: _seed_doc(fname) for fname in GENMOD.FILE_SHEETS}
    rows_by_sheet: dict[str, list[dict]] = {}
    for fname, (sheet, sections) in GENMOD.FILE_SHEETS.items():
        for section in sections:
            rows_by_sheet.setdefault(sheet, []).extend(docs[fname][section])
    refs = validation.build_ref_index(rows_by_sheet)
    errors: list[str] = []
    for fname, (sheet, sections) in GENMOD.FILE_SHEETS.items():
        for section in sections:
            errors.extend(
                f"{fname}[{section}]{e}"
                for e in validation.validate_rows(sheet, docs[fname][section], refs)
            )
    assert errors == []


def test_validator_catches_bad_enum_and_unresolved_fk():
    """The validator actually fires: V-R2 on a bad enum, V-R1 on a broken FK,
    and the no-floats rule on amounts."""
    doc = _seed_doc("cost_lines.v1.json")
    row = dict(doc["actual"][0])
    row["flow_type"] = "Dividend"  # V-R2
    assert any("flow_type" in e for e in validation.validate_row("1_CostLine", row))
    row = dict(doc["actual"][0])
    row["amount_local"] = 125000.0  # float on an amount — forbidden
    assert any("float" in e for e in validation.validate_row("1_CostLine", row))
    row = dict(doc["actual"][0])
    row["pool_id"] = "POOL-NOPE"  # V-R1
    refs = validation.build_ref_index({"3_Pool": _seed_doc("pools.v1.json")["rows"]})
    assert any("does not resolve" in e for e in validation.validate_row("1_CostLine", row, refs))


def test_generator_reemit_matches_committed_seeds():
    """The committed seeds are exactly what the generator derives from the
    warehouse + stewardship register today (drift check / determinism)."""
    docs = GENMOD.build_documents()
    assert GENMOD.validate_documents(docs) == []
    for fname, doc in docs.items():
        committed = (SEED_DIR / fname).read_text(encoding="utf-8")
        assert GENMOD.dump(doc) == committed, f"{fname} drifted — re-run generate_seeds.py"


def test_budget_variants_diverge_8_and_15_pct():
    """SPEC §9.2 style: budget chargeable base = actual × 0.92 on POOL-IT-US and
    × 0.85 on POOL-RSS-CH (one under, one over the 10% true-up warn threshold);
    management cost (the impure corporate center) is unchanged."""
    doc = _seed_doc("cost_lines.v1.json")

    def is_corp(cc: str) -> bool:
        # PB1: the impure corporate cost is decomposed into named sub-centers
        # (CC-{prov}-CORP-FIN/HR/LEGAL/FAC/BOARD); detect them by the -CORP marker.
        return "-CORP" in cc

    def base_by_period(rows: list[dict], provider: str) -> dict[str, Decimal]:
        """Chargeable pool base per period: pure lines + 20% of the corp centers."""
        out: dict[str, Decimal] = {}
        for r in rows:
            if r["provider_entity_id"] != provider:
                continue
            amount = Decimal(r["amount_local"])
            if is_corp(r["cost_center"]):
                amount *= Decimal("0.2")
            out[r["fiscal_period"]] = out.get(r["fiscal_period"], Decimal(0)) + amount
        return out

    for provider, factor in (
        ("1000", Decimal("0.92")),
        ("3100", Decimal("0.85")),
    ):
        actual = base_by_period(doc["actual"], provider)
        budget = base_by_period(doc["budget"], provider)
        assert sorted(actual) == sorted(budget)
        for period, actual_base in actual.items():
            assert budget[period] == (actual_base * factor).quantize(CENT), (provider, period)
        # the impure corporate centers (management cost) are unchanged in budget
        corp_actual = sorted(Decimal(r["amount_local"]) for r in doc["actual"]
                             if r["provider_entity_id"] == provider and is_corp(r["cost_center"]))
        corp_budget = sorted(Decimal(r["amount_local"]) for r in doc["budget"]
                             if r["provider_entity_id"] == provider and is_corp(r["cost_center"]))
        assert corp_actual == corp_budget


# ----------------------------------------------------------------- ledgers --


def test_ledger_roundtrip_insert_list_get(state_db):
    """Append-only insert/list/get for all four ledgers, straight from the seeds
    (plus synthetic engine-output rows for charge_ledger/recon)."""
    cost_doc = _seed_doc("cost_lines.v1.json")
    kv_doc = _seed_doc("key_values.v1.json")

    assert store.insert_cost_lines(cost_doc["actual"]) == len(cost_doc["actual"])
    assert store.insert_key_values(kv_doc["actual"]) == len(kv_doc["actual"])

    listed = store.list_cost_lines(provider_entity_id="1000", fiscal_period="2026-05")
    assert [r["cost_line_id"] for r in listed] == sorted(
        r["cost_line_id"] for r in cost_doc["actual"]
        if r["provider_entity_id"] == "1000" and r["fiscal_period"] == "2026-05"
    )
    sample = cost_doc["actual"][0]
    got = store.get_cost_line(sample["cost_line_id"])
    for k, v in sample.items():
        assert got[k] == v  # bools decode back to bool; decimals stay exact strings
    assert got["pass_through_flag"] is False

    kv_sample = kv_doc["actual"][0]
    got_kv = store.get_key_value(kv_sample["key_value_id"])
    for k, v in kv_sample.items():
        assert got_kv[k] == v

    charge = {
        "charge_id": "CHG-TEST-0001",
        "pool_id": "POOL-IT-US",
        "provider_entity_id": "1000",
        "recipient_entity_id": "3000",
        "period": "2026-05",
        "fiscal_year": "2026",
        "budget_or_actual": "Actual",
        "allocation_key_id": "KEY-IT-CONS",
        "allocation_ratio_applied": "1",
        "cost_recovered_amount": "3522150.00",
        "markup_pct_applied": "0.05",
        "markup_amount": "176107.50",
        "gross_charge_amount": "3698257.50",
        "charge_currency": "USD",
        "posting_date": "2026-06-05",
    }
    assert store.insert_charges([charge], run_id="RUN-TEST-1") == 1
    got_chg = store.get_charge("CHG-TEST-0001")
    for k, v in charge.items():
        assert got_chg[k] == v
    assert got_chg["run_id"] == "RUN-TEST-1"  # SPEC §3.2 run scoping
    assert [c["charge_id"] for c in store.list_charges(run_id="RUN-TEST-1")] == ["CHG-TEST-0001"]

    recon_row = {
        "recon_id": "RECON-TEST-0001",
        "run_id": "RUN-TEST-1",
        "run_timestamp": "2026-06-05T02:10:00+00:00",
        "period": "2026-05",
        "pool_id": "POOL-IT-US",
        "provider_entity_id": "1000",
        "total_pooled_cost": "3522150.00",
        "total_exclusions": "0.00",
        "total_cost_recovered": "3522150.00",
        "total_markup": "176107.50",
        "total_charged_out": "3698257.50",
        "unallocated_residual": "0.00",
        "recon_status": "Balanced",
    }
    assert store.insert_recon([recon_row]) == 1
    got_rec = store.get_recon("RECON-TEST-0001")
    for k, v in recon_row.items():
        assert got_rec[k] == v
    assert [r["recon_id"] for r in store.list_recon(run_id="RUN-TEST-1")] == ["RECON-TEST-0001"]


def test_ledgers_are_append_only(state_db):
    """No update/delete API exists for the ledgers, and a duplicate primary key
    is rejected — corrections are reversing rows, never edits."""
    import sqlite3

    for name in dir(store):
        assert not name.startswith(("update_", "delete_")), name
    doc = _seed_doc("cost_lines.v1.json")
    store.insert_cost_lines(doc["actual"][:1])
    with pytest.raises(sqlite3.IntegrityError):
        store.insert_cost_lines(doc["actual"][:1])


def test_insert_rejects_invalid_rows(state_db):
    """The store refuses rows that fail schema validation (V-R2 / shape)."""
    doc = _seed_doc("cost_lines.v1.json")
    bad = dict(doc["actual"][0], flow_type="Dividend")
    with pytest.raises(ValueError, match="flow_type"):
        store.insert_cost_lines([bad])
    no_amount = {k: v for k, v in doc["actual"][0].items() if k != "amount_local"}
    with pytest.raises(ValueError, match="amount_local"):
        store.insert_cost_lines([no_amount])


# ---------------------------------------------------------- allocation_runs --


def test_allocation_runs_insert_and_status_transitions(state_db):
    run = store.insert_run(
        run_id="RUN-2026-05-A1",
        period="2026-05",
        run_type="actual",
        input_snapshot_hash="a" * 64,
        scope={"poolIds": ["POOL-IT-US"]},
        config={"fxRateType": "monthly_average"},
    )
    assert run["status"] == "running"
    assert run["finished_at"] is None
    assert run["input_snapshot_hash"] == "a" * 64
    assert run["scope"] == {"poolIds": ["POOL-IT-US"]}
    assert run["schema_version"] == gen.SCHEMA_SHA256[:12]

    done = store.set_run_status("RUN-2026-05-A1", "succeeded")
    assert done["status"] == "succeeded"
    assert done["finished_at"] is not None

    # terminal states are immutable; unknown runs and bad types are rejected
    with pytest.raises(ValueError, match="illegal run transition"):
        store.set_run_status("RUN-2026-05-A1", "failed")
    with pytest.raises(ValueError, match="unknown run"):
        store.set_run_status("RUN-NOPE", "succeeded")
    with pytest.raises(ValueError, match="invalid run_type"):
        store.insert_run(run_id="RUN-X", period="2026-05", run_type="forecast",
                         input_snapshot_hash="b" * 64)

    assert [r["run_id"] for r in store.list_runs(period="2026-05")] == ["RUN-2026-05-A1"]


# ------------------------------------------------- reconciliation pre-check --


def test_seed_reconciliation_precheck_to_the_cent():
    """Σ(actual cost_lines per provider) == warehouse SERVICE pair cost base +
    flagged stewardship exclusions — Decimal, parquet read directly."""
    con = duckdb.connect()
    rows = con.execute(
        f"""
        SELECT SELLING_COMPANY, SUM(STANDARD_COST * TOTAL_VOLUME)
        FROM read_parquet('{SUPPLY_CHAIN}')
        WHERE MATERIAL_TYPE = 'SERVICE'
        GROUP BY 1
        """
    ).fetchall()
    con.close()
    warehouse_cb = {provider: total for provider, total in rows}
    assert set(warehouse_cb) == {"1000", "3100"}
    for total in warehouse_cb.values():
        assert isinstance(total, Decimal)  # DuckDB DECIMAL -> Decimal, no floats

    stw_doc = json.loads(
        (BACKEND / "seeds" / "finance" / "stewardship.v1.json").read_text(encoding="utf-8")
    )
    stw = {"1000": Decimal(0), "3100": Decimal(0)}
    for line in stw_doc["lines"]:
        if line["stewardship"]:
            stw[line["rbukrs"]] += Decimal(str(line["amount"]))
    assert stw == {"1000": Decimal("4250000"), "3100": Decimal("2700000")}

    cost_doc = _seed_doc("cost_lines.v1.json")
    for provider in ("1000", "3100"):
        seeded = sum(
            Decimal(r["amount_local"])
            for r in cost_doc["actual"]
            if r["provider_entity_id"] == provider
        )
        assert seeded == warehouse_cb[provider] + stw[provider], provider

    # exclusions tie to the register per provider, to the cent
    excl_doc = _seed_doc("exclusions.v1.json")
    excl = {"1000": Decimal(0), "3100": Decimal(0)}
    for r in excl_doc["rows"]:
        provider = "1000" if r["pool_id"].endswith("-US") else "3100"
        excl[provider] += Decimal(r["exclusion_amount"])
    assert excl == stw


def test_chargeable_pool_base_ties_per_period():
    """Per (provider, period): pure pool lines + 20% of the corporate center
    equal the warehouse pair cost base for that period exactly."""
    con = duckdb.connect()
    rows = con.execute(
        f"""
        SELECT SELLING_COMPANY, GJAHR, POPER, SUM(STANDARD_COST * TOTAL_VOLUME)
        FROM read_parquet('{SUPPLY_CHAIN}')
        WHERE MATERIAL_TYPE = 'SERVICE'
        GROUP BY 1, 2, 3
        """
    ).fetchall()
    con.close()
    cb_period = {
        (provider, f"{gjahr}-{int(poper):02d}"): total
        for provider, gjahr, poper, total in rows
    }
    cost_doc = _seed_doc("cost_lines.v1.json")
    # PB1: corporate cost is spread across named sub-centers (CC-{prov}-CORP-*);
    # the per-line nickel-grain split keeps every 20% slice cent-exact.
    def is_corp(cc: str) -> bool:
        return "-CORP" in cc

    for (provider, period), cb_total in cb_period.items():
        pure = sum(
            Decimal(r["amount_local"]) for r in cost_doc["actual"]
            if r["provider_entity_id"] == provider and r["fiscal_period"] == period
            and not is_corp(r["cost_center"])
        )
        corp_svc = sum(
            (Decimal(r["amount_local"]) * Decimal("0.2") for r in cost_doc["actual"]
             if r["provider_entity_id"] == provider and r["fiscal_period"] == period
             and is_corp(r["cost_center"])),
            Decimal(0),
        )
        assert pure + corp_svc == cb_total, (provider, period)
