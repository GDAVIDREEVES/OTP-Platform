"""TDD for the calc run history (state/calc_runs.py) + run persistence/audit
through services/calc_registry.py:run() (CS-a).

Run from `backend/`:  python -m pytest tests/test_calc_runs.py
"""

from __future__ import annotations

import pytest

import services.calc_registry as calc_registry
import state.audit as audit
import state.calc_runs as calc_runs
import state.parameters as parameters


# --- insert/list/get round-trip -------------------------------------------------

def test_insert_list_get_roundtrip(state_db):
    row = calc_runs.insert_run(
        calc_id="csa", actor="u_demo", status="succeeded",
        args={"year": 2026}, duration_ms=12, output_digest="abc123",
        summary={"pool": 10.8}, params_read=[{"step": "param", "key": "csa.growth"}],
        trace=[{"step": "aggregate", "table": "segment_pl"}],
    )
    assert row["id"] == 1
    assert row["calc_id"] == "csa"
    assert row["status"] == "succeeded"
    # *_json columns come back parsed.
    assert row["args"] == {"year": 2026}
    assert row["summary"] == {"pool": 10.8}
    assert row["params_read"][0]["key"] == "csa.growth"
    assert row["trace"][0]["table"] == "segment_pl"
    assert "args_json" not in row and "trace_json" not in row

    assert calc_runs.get_run(row["id"]) == row
    assert calc_runs.get_run(999) is None
    assert calc_runs.list_runs() == [row]


def test_list_runs_filters_and_orders_newest_first(state_db):
    calc_runs.insert_run(calc_id="csa", actor="a", status="succeeded")
    calc_runs.insert_run(calc_id="beat", actor="a", status="failed", error="boom")
    calc_runs.insert_run(calc_id="csa", actor="b", status="succeeded", scenario_id="SC-1")

    all_runs = calc_runs.list_runs()
    assert [r["id"] for r in all_runs] == [3, 2, 1]  # newest first
    assert [r["calc_id"] for r in calc_runs.list_runs(calc_id="csa")] == ["csa", "csa"]
    assert [r["id"] for r in calc_runs.list_runs(scenario_id="SC-1")] == [3]
    assert [r["id"] for r in calc_runs.list_runs(status="failed")] == [2]
    assert len(calc_runs.list_runs(limit=2)) == 2


def test_insert_invalid_status_raises(state_db):
    with pytest.raises(ValueError):
        calc_runs.insert_run(calc_id="csa", actor="a", status="bogus")


# --- run() persistence + audit ---------------------------------------------------

def test_run_persists_a_row_without_output_body(state_db):
    parameters.seed_if_empty()
    result = calc_registry.run("csa", actor="u_demo")
    assert "output" in result and result["output"]["pool"] > 0

    rows = calc_runs.list_runs(calc_id="csa")
    assert len(rows) == 1
    row = rows[0]
    assert row["status"] == "succeeded"
    assert row["actor"] == "u_demo"
    assert row["args"] == {"year": 2026}
    assert row["output_digest"] == result["output_digest"]
    assert row["summary"]["pool"] == result["output"]["pool"]
    assert "output" not in row  # the body is returned, never persisted


def test_digest_stable_across_identical_runs(state_db):
    parameters.seed_if_empty()
    r1 = calc_registry.run("csa", actor="u_demo")
    r2 = calc_registry.run("csa", actor="u_demo")
    assert r1["output_digest"] == r2["output_digest"]
    assert len(calc_runs.list_runs(calc_id="csa")) == 2


def test_run_audited_at_calc_ref_and_chain_intact(state_db):
    parameters.seed_if_empty()
    result = calc_registry.run("csa", actor="u_demo")

    events = audit.list_events(record_ref="calc:csa")
    runs = [e for e in events if e["event_type"] == "run"]
    assert len(runs) == 1
    assert runs[0]["actor"] == "u_demo"
    assert runs[0]["process_id"] == "OTP-5"
    assert runs[0]["after"]["digest"] == result["output_digest"]
    assert runs[0]["after"]["summary"]["pool"] == result["output"]["pool"]
    assert audit.verify_chain()["ok"] is True


def test_failed_handler_persists_failed_run(state_db, monkeypatch):
    parameters.seed_if_empty()

    def boom():
        raise RuntimeError("handler exploded")

    monkeypatch.setitem(calc_registry._RUNNERS, "csa", (boom, {}))
    with pytest.raises(RuntimeError, match="handler exploded"):
        calc_registry.run("csa", actor="u_demo")

    rows = calc_runs.list_runs(calc_id="csa", status="failed")
    assert len(rows) == 1
    assert rows[0]["error"] == "handler exploded"
    assert rows[0]["output_digest"] is None
    # No "run" audit event for the failure — only successful runs are chained.
    assert audit.list_events(record_ref="calc:csa") == []
