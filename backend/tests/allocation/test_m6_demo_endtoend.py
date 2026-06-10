"""M6 gate — DEMO END-TO-END over the committed allocation seeds
(ADAPTATION D2/D5): budget + actual runs for all four billing periods, the
annual true-up, the API surface and the Calc Studio registration.

Covers, in order:
- 4 budget runs + 4 actual runs + the true-up over the demo seeds via the
  orchestrator: every run succeeds, recon Balanced with zero residual
  EVERYWHERE;
- the FY warehouse ties survive persistence (ADAPTATION D2): Σ actual
  cost_recovered_amount == SERVICE pair cost base and Σ gross == pair gross
  per (provider, recipient), TO THE CENT; OTP-15 exclusions = 6,950,000.00;
- the true-up fires V-X3 exactly ONCE (POOL-RSS-CH, the 15% divergence;
  POOL-IT-US's 8% stays under), deltas positive (budget under actuals),
  parents = the latest booked Budget charges, management pools emit nothing;
- the API: POST /api/allocation/runs + every GET (runs, run, charges, recon,
  exceptions, docs, doc, charge lineage drill);
- Calc Studio: the ``service_allocation`` registry run persists a calc_runs
  row, audits at calc:service_allocation, shapes the SEVEN-stage trace, and
  is hash-equivalent to the POST API run (same inputs → same output hash —
  the registry↔API golden equivalence for a POST-backed calculation).

NO float arithmetic on amounts anywhere in this file (ENGINE-CLAUDE.md).

Run from backend/:
    ../.venv/bin/python -m pytest tests/allocation/test_m6_demo_endtoend.py
"""

from __future__ import annotations

import json
from decimal import Decimal

import duckdb
import pytest
from fastapi.testclient import TestClient

import services.allocation_runner as runner
import services.calc_registry as calc_registry
import services.calc_traces as calc_traces
import state.allocation_store as store
import state.audit as audit
import state.engine as engine
from config import SUPPLY_CHAIN
from main import app

client = TestClient(app)

PERIODS = ["2026-04", "2026-05", "2026-10", "2026-11"]
ZERO = Decimal("0")
STAGE_IDS = ["capture", "pool", "benefit_gate", "allocate", "markup",
             "chargeout", "reconcile"]


@pytest.fixture(scope="module")
def demo(tmp_path_factory):
    """One isolated DB: 4 budget + 4 actual runs + the true-up, once."""
    engine.configure(tmp_path_factory.mktemp("demo") / "state.db")
    engine.init_db()
    runs = {"budget": {}, "actual": {}}
    for run_type in ("budget", "actual"):
        for period in PERIODS:
            runs[run_type][period] = runner.run_allocation(
                period=period, run_type=run_type, actor="demo")
    trueup = runner.run_allocation(period="2026", run_type="trueup",
                                   actor="demo")
    yield {"runs": runs, "trueup": trueup}
    engine.close()


def _warehouse_pairs() -> tuple[dict, dict]:
    """FY SERVICE pair cost base + gross per (provider, recipient) —
    Decimal end to end (DuckDB DECIMAL; no floats off the warehouse)."""
    con = duckdb.connect()
    rows = con.execute(
        f"""
        SELECT SELLING_COMPANY, BUYING_COMPANY,
               SUM(STANDARD_COST * TOTAL_VOLUME), SUM(TOTAL_LEGAL_PRICE)
        FROM read_parquet('{SUPPLY_CHAIN}')
        WHERE MATERIAL_TYPE = 'SERVICE'
        GROUP BY 1, 2
        """
    ).fetchall()
    con.close()
    cb, gross = {}, {}
    for provider, recipient, pair_cb, pair_gross in rows:
        assert isinstance(pair_cb, Decimal) and isinstance(pair_gross, Decimal)
        cb[(provider, recipient)] = pair_cb
        gross[(provider, recipient)] = pair_gross
    return cb, gross


# ---------------------------------------------------------- recon everywhere --


def test_all_nine_runs_succeed_with_balanced_zero_residual_recon(demo):
    """Every run Balanced everywhere — pooled = exclusions + recovered + 0
    (V-X1 hard zero) across budget, actual AND the true-up."""
    run_ids = [demo["runs"][t][p]["run_id"]
               for t in ("budget", "actual") for p in PERIODS]
    run_ids.append(demo["trueup"]["run_id"])
    for run_id in run_ids:
        assert store.get_run(run_id)["status"] == "succeeded"
        recon = store.list_recon(run_id=run_id)
        assert recon, run_id
        for row in recon:
            assert row["recon_status"] == "Balanced", (run_id, row["pool_id"])
            assert Decimal(row["unallocated_residual"]) == ZERO


def test_budget_and_actual_runs_fire_no_v_rules(demo):
    for run_type in ("budget", "actual"):
        for period in PERIODS:
            report = demo["runs"][run_type][period]["exception_report"]
            assert report["exceptions"] == [], (run_type, period)


# ------------------------------------------------------- FY warehouse ties ---


def test_fy_actual_charges_tie_to_the_warehouse_to_the_cent(demo):
    """ADAPTATION D2 — the persisted actual ledger reproduces the SERVICE
    pair totals: Σ cost == pair cost base AND Σ gross == pair gross per
    (provider, recipient), to the cent."""
    cb, gross = _warehouse_pairs()
    fy_cost: dict[tuple[str, str], Decimal] = {}
    fy_gross: dict[tuple[str, str], Decimal] = {}
    for period in PERIODS:
        run_id = demo["runs"]["actual"][period]["run_id"]
        for row in store.list_charges(run_id=run_id):
            key = (row["provider_entity_id"], row["recipient_entity_id"])
            fy_cost[key] = (fy_cost.get(key, ZERO)
                            + Decimal(row["cost_recovered_amount"]))
            fy_gross[key] = (fy_gross.get(key, ZERO)
                             + Decimal(row["gross_charge_amount"]))
    assert fy_cost == cb
    assert fy_gross == gross
    assert set(fy_cost) == {("1000", "3000"), ("3100", "3200"),
                            ("3100", "3300"), ("3100", "3800")}


def test_fy_exclusions_tie_to_the_otp15_stewardship_register(demo):
    """ADAPTATION D2 — Σ recon exclusions across the actual year ==
    6,950,000.00 (4,250,000.00 provider 1000 / 2,700,000.00 provider 3100)."""
    by_provider: dict[str, Decimal] = {}
    for period in PERIODS:
        run_id = demo["runs"]["actual"][period]["run_id"]
        for row in store.list_recon(run_id=run_id):
            by_provider[row["provider_entity_id"]] = (
                by_provider.get(row["provider_entity_id"], ZERO)
                + Decimal(row["total_exclusions"]))
    assert by_provider == {"1000": Decimal("4250000.00"),
                           "3100": Decimal("2700000.00")}


# ------------------------------------------------------------- true-up -------


def test_demo_trueup_fires_v_x3_once_on_pool_rss_ch(demo):
    """The seeded 15% divergence (POOL-RSS-CH, budget_factor 0.85) is the
    ONLY pool over the 10% threshold; POOL-IT-US's 8% stays under."""
    report = demo["trueup"]["exception_report"]
    assert [(e["rule_id"], e["pool_id"], e["severity"])
            for e in report["exceptions"]] \
        == [("V-X3", "POOL-RSS-CH", "WARN")]


def test_demo_trueup_rows_positive_deltas_with_booked_parents(demo):
    """Actuals overrun budget on both service pools → POSITIVE True-up rows
    per recipient, each linked to the latest booked Budget charge; the
    100%-excluded management pools emit nothing."""
    rows = store.list_charges(run_id=demo["trueup"]["run_id"])
    assert {r["pool_id"] for r in rows} == {"POOL-IT-US", "POOL-RSS-CH"}
    assert {r["recipient_entity_id"] for r in rows} \
        == {"3000", "3200", "3300", "3800"}
    for row in rows:
        assert row["budget_or_actual"] == "True-up"
        assert row["period"] == "2026" and row["fiscal_year"] == "2026"
        assert Decimal(row["gross_charge_amount"]) > ZERO
        parent = store.get_charge(row["true_up_parent_charge_id"])
        assert parent is not None
        assert parent["budget_or_actual"] == "Budget"
        assert parent["pool_id"] == row["pool_id"]
        # the latest booked period for the pool's provider
        assert parent["period"] in ("2026-10", "2026-11")
    recon = {r["pool_id"]: r
             for r in store.list_recon(run_id=demo["trueup"]["run_id"])}
    assert Decimal(recon["POOL-RSS-CH"]["true_up_delta"]) > ZERO
    assert Decimal(recon["POOL-IT-US"]["true_up_delta"]) > ZERO
    assert recon["POOL-MGMT-US"]["true_up_delta"] is None


# ------------------------------------------------------------------ API ------


def test_api_post_run_and_read_back(demo):
    """POST /api/allocation/runs launches a run; the GET surface serves the
    run, its charges, recon, exception report and doc pack."""
    resp = client.post("/api/allocation/runs",
                       json={"period": "2026-05", "run_type": "actual",
                             "actor": "api-demo"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "succeeded"
    run_id = body["run_id"]
    assert body["summary"]["recon_balanced"] is True

    listed = client.get("/api/allocation/runs").json()
    assert any(r["run_id"] == run_id for r in listed)
    listed_p = client.get("/api/allocation/runs",
                          params={"period": "2026-05"}).json()
    assert all(r["period"] == "2026-05" for r in listed_p)

    detail = client.get(f"/api/allocation/runs/{run_id}").json()
    assert detail["status"] == "succeeded"
    assert detail["summary"]["output_hash"]
    assert any(a["name"] == "output.sha256" for a in detail["artifacts"])

    charges = client.get(f"/api/allocation/runs/{run_id}/charges").json()
    assert len(charges) == 1  # 2026-05: the 1000 -> 3000 IT leg
    recon = client.get(f"/api/allocation/runs/{run_id}/recon").json()
    assert {r["recon_status"] for r in recon} == {"Balanced"}
    exceptions = client.get(f"/api/allocation/runs/{run_id}/exceptions").json()
    assert exceptions["counts"] == {"BLOCK": 0, "WARN": 0}

    docs = client.get(f"/api/allocation/runs/{run_id}/docs").json()
    assert [d["name"] for d in docs] == [
        "docs/POOL-IT-US.md", "docs/POOL-MGMT-CH.md",
        "docs/POOL-MGMT-US.md", "docs/POOL-RSS-CH.md"]
    doc = client.get(f"/api/allocation/runs/{run_id}/docs/POOL-IT-US.md"
                     .replace(".md", "")).json()
    assert "## 8. Reconciliation tie-out" in doc["markdown"]
    assert client.get(
        f"/api/allocation/runs/{run_id}/docs/POOL-NOPE").status_code == 404
    assert client.get("/api/allocation/runs/RUN-NOPE").status_code == 404


def test_api_charge_lineage_drills_to_cost_lines(demo):
    """GET /api/allocation/charges/{id}/lineage — charge -> constituent cost
    lines (SPEC §8 audit lineage), and the true-up drill to its parent."""
    run_id = demo["runs"]["actual"]["2026-05"]["run_id"]
    (charge,) = store.list_charges(run_id=run_id)
    body = client.get(
        f"/api/allocation/charges/{charge['charge_id']}/lineage").json()
    assert body["pool_id"] == "POOL-IT-US"
    assert body["charge_kind"] == "allocated"
    assert body["key_value_id"]
    assert body["line_ids"] and len(body["lines"]) == len(body["line_ids"])
    assert all(l["pool_id"] == "POOL-IT-US" for l in body["lines"])
    # the pooled lines sum to the charge's cost (single-recipient pool)
    total = sum((Decimal(l["amount_local"]) for l in body["lines"]), ZERO)
    assert total == Decimal(charge["cost_recovered_amount"])

    tu_row = store.list_charges(run_id=demo["trueup"]["run_id"])[0]
    drill = client.get(
        f"/api/allocation/charges/{tu_row['charge_id']}/lineage").json()
    assert drill["charge_kind"] == "true_up"
    assert drill["true_up_parent_charge_id"] \
        == tu_row["true_up_parent_charge_id"]
    assert client.get(
        "/api/allocation/charges/NOPE/lineage").status_code == 404


def test_api_rejects_malformed_launches(demo):
    assert client.post("/api/allocation/runs",
                       json={"run_type": "actual", "actor": "t"}
                       ).status_code == 400          # no period
    assert client.post("/api/allocation/runs",
                       json={"period": "2026-05", "run_type": "nope",
                             "actor": "t"}).status_code == 400
    assert client.post("/api/allocation/runs",
                       json={"period": "2026-05", "run_type": "trueup",
                             "actor": "t"}).status_code == 400  # year required


# ------------------------------------------------- Calc Studio registration --


def test_registry_run_lands_in_job_console_with_seven_stage_trace(demo):
    """calc_registry.run("service_allocation") — the POST-equivalent run:
    calc_runs row + audit at calc:service_allocation AND allocation:{run_id},
    shaped trace = the seven SPEC §4 stage summaries."""
    res = calc_registry.run("service_allocation", actor="studio")
    assert res["status"] == "succeeded"
    out = res["output"]
    assert out["status"] == "succeeded"
    assert out["run_type"] == "actual"
    assert out["period"] == "2026-11"          # latest demo actual period
    assert out["recon_balanced"] is True

    d = calc_registry.get_def("service_allocation")
    for key in d["summary_keys"]:
        assert key in out, key
    assert res["summary"]["run_id"] == out["run_id"]

    # the orchestrator's stage events were collected into the run trace
    stage_steps = [s for s in res["trace"] if s["step"] == "stage"]
    assert [s["stage"] for s in stage_steps] == STAGE_IDS

    shaped = calc_traces.shape_trace(res, d, output=out)
    assert [s["id"] for s in shaped] == STAGE_IDS
    recon_step = next(s for s in shaped if s["id"] == "reconcile")
    assert recon_step["values"]["balanced"] == 4
    for step in shaped:
        for sid in step["sources"]:
            assert sid in d["inputs"]["catalog"]

    # audited twice: the registry event AND the allocation run event
    calc_events = audit.list_events(record_ref="calc:service_allocation")
    assert any(e["event_type"] == "run" for e in calc_events)
    run_events = audit.list_events(record_ref=f"allocation:{out['run_id']}")
    assert len(run_events) == 1
    assert run_events[0]["process_id"] == "OTP-10"


def test_registry_run_hash_equivalent_to_post_api_run(demo):
    """The registry↔API golden equivalence for the POST-backed calculation:
    the SAME inputs produce the SAME deterministic output hash through both
    paths (V-X4's guarantee), even though each launch appends its own run."""
    reg = calc_registry.run("service_allocation", actor="studio",
                            args={"period": "2026-04"})
    resp = client.post("/api/allocation/runs",
                       json={"period": "2026-04", "run_type": "actual",
                             "actor": "api"})
    assert resp.status_code == 200
    api_summary = resp.json()["summary"]
    assert reg["output"]["output_hash"] == api_summary["output_hash"]
    assert reg["output"]["run_id"] != api_summary["run_id"]  # two real runs
    assert reg["output"]["total_charged_out"] \
        == api_summary["total_charged_out"]


def test_registry_shaped_trace_survives_for_historical_runs(demo):
    """Historical runs (output body never persisted) shape the seven stages
    retroactively from the persisted trace events via the run console API."""
    import state.calc_runs as calc_runs
    run_row = calc_runs.list_runs(calc_id="service_allocation", limit=1)[0]
    resp = client.get(f"/api/runs/{run_row['id']}", params={"shaped": "true"})
    assert resp.status_code == 200
    assert [s["id"] for s in resp.json()["shaped_trace"]] == STAGE_IDS
