"""TDD for the calculation registry + runner (services/calc_registry.py, CS-a).

The keystone is golden equivalence: for every GET-backed calculation, a
registry run's output is byte-identical (canonical-JSON equal) to the HTTP
response of the calculation's own endpoint — proving direct handler invocation
== the API and that the hand-written default kwargs are right (including the
FastAPI Query-default gotcha on segments_pl/berry). service_allocation (M6)
is POST-backed and WRITES the allocation ledgers, so its registry↔API
equivalence is asserted on the run's deterministic output hash instead
(tests/allocation/test_m6_demo_endtoend.py).

Seed integrity: every inputs.catalog id resolves via services/catalog.py and
every inputs.parameters key exists in the seeded governed parameter store.

Run from `backend/`:  python -m pytest tests/test_calc_registry.py
"""

from __future__ import annotations

import json

import pytest
from fastapi.encoders import jsonable_encoder
from fastapi.testclient import TestClient

import services.calc_registry as calc_registry
import services.catalog as catalog
import state.parameters as parameters
from main import app

client = TestClient(app)

ALL_IDS = [d["id"] for d in calc_registry.defs()]

EXPECTED_IDS = [
    "csa", "profit_split", "beat", "treasury", "wht", "reconciliation",
    "forecast", "stewardship", "flows", "royalties", "pricing", "invoices",
    "segments_pl", "berry", "service_allocation",
]

# GET-backed calculations: registry run == HTTP body, byte-identical.
# service_allocation launches a run (POST, ledger writes) — excluded here,
# hash-equivalence asserted in tests/allocation/test_m6_demo_endtoend.py.
GET_BACKED_IDS = [i for i in EXPECTED_IDS if i != "service_allocation"]


def _canonical(obj) -> str:
    return json.dumps(jsonable_encoder(obj), sort_keys=True)


def _normalise(calc_id: str, body):
    """flows' payors/payees come from DuckDB LIST(DISTINCT …), whose element
    order is unstable across executions — the ENDPOINT itself returns the two
    set-valued fields in arbitrary order call to call. Sort just those fields
    so equality tests the canonical form; everything else stays byte-exact."""
    if calc_id == "flows":
        return [
            {**row, "payors": sorted(row["payors"]), "payees": sorted(row["payees"])}
            for row in body
        ]
    return body


# --- Registry seed integrity ---------------------------------------------------

def test_registry_has_all_15_calcs():
    assert ALL_IDS == EXPECTED_IDS
    assert len(set(ALL_IDS)) == 15


def test_every_calc_has_a_runner():
    assert set(calc_registry._RUNNERS) == set(ALL_IDS)


def test_get_def():
    d = calc_registry.get_def("csa")
    assert d is not None
    assert d["endpoint"] == "/api/csa"
    assert calc_registry.get_def("nope") is None


def test_inputs_catalog_ids_resolve(state_db):
    parameters.seed_if_empty()
    for d in calc_registry.defs():
        for cid in d["inputs"]["catalog"]:
            assert catalog.entry(cid) is not None, f"{d['id']}: unknown catalog id {cid}"


def test_inputs_parameter_keys_exist(state_db):
    parameters.seed_if_empty()
    for d in calc_registry.defs():
        for key in d["inputs"]["parameters"]:
            assert parameters.get_param_row(key) is not None, (
                f"{d['id']}: unknown parameter {key}"
            )


def test_parameter_reader_counts_match_handlers():
    """Only the get_param-reading handlers declare parameters (csa 2,
    profit_split 3, beat 6, reconciliation 1, forecast 1 — the W2
    pl.use_post_charge basis toggle); everything else is []."""
    expected = {"csa": 2, "profit_split": 3, "beat": 6, "reconciliation": 1,
                "forecast": 1}
    for d in calc_registry.defs():
        assert len(d["inputs"]["parameters"]) == expected.get(d["id"], 0), d["id"]


def test_scenario_capable_flags():
    capable = {d["id"] for d in calc_registry.defs() if d["scenario_capable"]}
    assert capable == {"csa", "profit_split", "beat", "reconciliation"}


def test_csa_summary_keys_exist_in_output(state_db):
    parameters.seed_if_empty()
    d = calc_registry.get_def("csa")
    out = calc_registry.run("csa", actor="t")["output"]
    for k in d["summary_keys"]:
        assert k in out, f"summary key {k} missing from csa output"


# --- THE KEYSTONE: registry run == HTTP, byte-identical, for every GET calc ----

@pytest.mark.parametrize("calc_id", GET_BACKED_IDS)
def test_run_output_byte_identical_to_endpoint(state_db, calc_id):
    parameters.seed_if_empty()
    d = calc_registry.get_def(calc_id)
    _, defaults = calc_registry._RUNNERS[calc_id]
    # The HTTP query mirrors the runner defaults (None == omitted), so both
    # sides execute the handler with identical kwargs.
    params = {k: v for k, v in defaults.items() if v is not None}

    run = calc_registry.run(calc_id, actor="t")
    resp = client.get(d["endpoint"], params=params)
    assert resp.status_code == 200
    assert _canonical(_normalise(calc_id, jsonable_encoder(run["output"]))) == _canonical(
        _normalise(calc_id, resp.json())
    )


# --- Trace + params_read -------------------------------------------------------

def test_csa_run_traces_params_and_kernels(state_db):
    parameters.seed_if_empty()
    run = calc_registry.run("csa", actor="t")
    keys = {p["key"] for p in run["params_read"]}
    assert "csa.growth" in keys
    assert "csa.pct_mult" in keys
    steps = {s["step"] for s in run["trace"]}
    assert "aggregate" in steps
    assert "allocate" in steps


def test_treasury_run_reads_no_params(state_db):
    parameters.seed_if_empty()
    run = calc_registry.run("treasury", actor="t")
    assert run["params_read"] == []


def test_list_outputs_summarised_as_row_count(state_db):
    parameters.seed_if_empty()
    run = calc_registry.run("flows", actor="t")
    assert set(run["summary"]) == {"rows"}
    assert run["summary"]["rows"] == len(run["output"])


# --- Guard rails ---------------------------------------------------------------

def test_run_unknown_calc_raises(state_db):
    with pytest.raises(ValueError):
        calc_registry.run("nope", actor="t")


def test_scenario_overrides_enabled_in_cs_c(state_db):
    """The CS-a "scenarios not yet enabled" guard is gone: overrides overlay
    get_param reads for the run (full coverage in tests/test_scenarios.py)."""
    parameters.seed_if_empty()
    run = calc_registry.run("csa", actor="t", scenario_overrides={"csa.growth": 0.1})
    assert run["output"]["growth"] == 0.1
    assert run["scenario_sensitive"] is True


def test_trace_inert_outside_collect(state_db):
    """emit() outside collect() is a no-op — ordinary HTTP requests are
    untouched by the instrumentation."""
    parameters.seed_if_empty()
    from calc import trace

    assert trace._COLLECTOR.get() is None
    trace.emit("param", key="x", value=1, overridden=False)  # must not raise
    resp = client.get("/api/csa", params={"year": 2026})
    assert resp.status_code == 200
