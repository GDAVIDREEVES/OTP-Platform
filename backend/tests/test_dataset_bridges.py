"""DS3 gate — the dataset BRIDGES into calc + allocation (Phase 8).

A dataset is a data-prep graph that compiles to ONE safe parameterized DuckDB
query (calc/dataset.py — DuckDB stays the engine, no new evaluator). DS3 wires
two bridges so a dataset can FEED the rest of the platform:

* **calc bridge** — a ``dataset_value`` boundary node (calc/graph.py) runs a
  dataset that aggregates to a single scalar and emits that Decimal into a calc
  graph. The compiled expression is the exact scalar (money-exact); an under-
  specified node (zero/many rows, missing column, non-numeric) is a precise
  per-node error, never a guessed default.
* **allocation bridge** — an authored pool's ``cost_capture_rule`` may name an
  ACTIVE ``dataset_id`` whose cost-line-shaped dataset (provider / cost_center /
  profit_center / cost_element / amount / period) supplies the Source-stage cost
  base instead of the seed cost_lines. The captured cost ties out to the
  dataset's ``SUM(amount)`` to the cent and the dry-run reconciles to ZERO
  residual (the real Stages 1-7 run over it unchanged).

GOLDEN non-regression: the governed demo allocation run (actual, all periods) is
cent-exact (FY 14,344,773.26) — a dataset-sourced pool never touches it.

NO float arithmetic on money anywhere in this file (Decimal only).

Run from backend/:  ../.venv/bin/python -m pytest tests/test_dataset_bridges.py
"""

from __future__ import annotations

from decimal import Decimal

import pytest

import calc.dataset as dataset
import calc.expr as expr
import calc.graph as graph
import services.allocation_runner as runner
import state.allocation_store as store
import state.authored_datasets as authored_datasets
import state.authored_pools as authored_pools
import state.engine as engine
import state.review as review

ZERO = Decimal("0")
GOVERNED_PERIODS = ["2026-04", "2026-05", "2026-10", "2026-11"]


@pytest.fixture()
def db(tmp_path):
    """Isolated SQLite state DB per test (authored datasets + pools live here)."""
    engine.configure(tmp_path / "state.db")
    engine.init_db()
    yield
    engine.close()


# --- Dataset fixtures (real warehouse / seed columns, not invented) ------------


def _journal_total_graph() -> dict:
    """journal -> aggregate(no group; SUM HSL AS total_hsl) — a single scalar."""
    return {
        "nodes": [
            {"id": "src", "type": "source",
             "config": {"table": "journal_entries", "columns": ["HSL"]}},
            {"id": "agg", "type": "aggregate",
             "config": {"group_by": [],
                        "measures": [{"column": "HSL", "func": "SUM",
                                      "alias": "total_hsl"}]}},
        ],
        "edges": [{"source": "src", "target": "agg"}],
    }


def _cost_line_pool_graph() -> dict:
    """A cost-line-shaped dataset over the fabricated allocation cost lines:
    filter to provider 1000 / the IT-OPS cost centers / the ACTUAL ledger, then
    project the cost-line columns. Touches 2026-05 / 2026-11; SUM = 2,292,280."""
    return {
        "nodes": [
            {"id": "src", "type": "source",
             "config": {"table": "allocation_cost_lines"}},
            {"id": "flt", "type": "filter", "config": {"predicates": [
                {"column": "provider_entity_id", "op": "=", "value": "1000"},
                {"column": "ledger", "op": "=", "value": "actual"},
                {"column": "cost_center", "op": "IN",
                 "values": ["CC-1000-IT-OPS-ERP", "CC-1000-IT-OPS-SUPPORT"]},
            ]}},
            {"id": "sel", "type": "select", "config": {"columns": [
                "provider_entity_id", "company_code", "cost_center",
                "profit_center", "cost_element", "amount_local",
                "currency_local", "fiscal_period"]}},
        ],
        "edges": [{"source": "src", "target": "flt"},
                  {"source": "flt", "target": "sel"}],
    }


def _activate_dataset(graph_def: dict, *, name: str = "DS bridge",
                      maker: str = "u_maria", checker: str = "u_sam") -> dict:
    """Full lifecycle draft -> tested -> in_review -> active (maker != checker)."""
    d = authored_datasets.create_authored_dataset(
        name=name, definition=graph_def, actor=maker)
    authored_datasets.test_run(d["id"], actor=maker)
    authored_datasets.submit_for_activation(d["id"], maker=maker)
    item = next(i for i in review.list_queue("pending")
                if i["record_ref"] == f"dataset:{d['id']}")
    review.decide(item["id"], checker=checker, decision="approve")
    return authored_datasets.get_authored_dataset(d["id"])


# ============================================================================
# Calc bridge — dataset_value boundary node feeds a calc graph (Decimal-exact)
# ============================================================================


def test_dataset_value_resolves_inline_dataset_scalar():
    """A dataset_value node carrying an INLINE dataset graph resolves to that
    dataset's single scalar (the journal HSL total), Decimal-exact."""
    # The dataset alone yields the scalar we expect.
    res = dataset.run_dataset(_journal_total_graph())
    assert res["row_count"] == 1
    total = res["rows"][0]["total_hsl"]
    assert isinstance(total, Decimal)

    node = {"id": "dv", "type": "dataset_value",
            "config": {"graph": _journal_total_graph(), "column": "total_hsl"}}
    scalar = graph._resolve_dataset_scalar(node["config"], "dv")
    assert scalar == total
    assert isinstance(scalar, Decimal)


def test_dataset_value_feeds_calc_graph_preview_decimal_exact():
    """A calc graph whose leaf is a dataset_value (× 2) compiles to the exact
    scalar literal and evaluates Decimal-exact through the unchanged engine."""
    total = dataset.run_dataset(_journal_total_graph())["rows"][0]["total_hsl"]
    calc_graph = {
        "nodes": [
            {"id": "dv", "type": "dataset_value",
             "config": {"graph": _journal_total_graph(), "column": "total_hsl"}},
            {"id": "two", "type": "const", "config": {"value": "2"}},
            {"id": "mul", "type": "op", "config": {"op": "*"}},
            {"id": "out", "type": "output", "config": {}},
        ],
        "edges": [
            {"source": "dv", "sourceHandle": "out", "target": "mul",
             "targetHandle": "a"},
            {"source": "two", "sourceHandle": "out", "target": "mul",
             "targetHandle": "b"},
            {"source": "mul", "sourceHandle": "out", "target": "out",
             "targetHandle": "in"},
        ],
    }
    rep = graph.validate_graph(calc_graph)
    assert rep["ok"], rep["errors"]

    expression = graph.graph_to_expr(calc_graph)
    # The dataset scalar is emitted as an exact Decimal literal (no float).
    assert str(total) in expression
    value = expr.evaluate(expression)
    assert value == total * Decimal("2")
    assert isinstance(value, Decimal)

    # The per-node preview paints the dataset_value node with the exact scalar.
    node_exprs = graph.node_exprs(calc_graph)
    assert expr.evaluate(node_exprs["dv"]) == total


def test_dataset_value_resolves_active_authored_dataset(db):
    """A dataset_value node may instead name an ACTIVE authored dataset_id — the
    compiler inlines its query; the scalar matches the dataset's own run."""
    d = _activate_dataset(_journal_total_graph(), name="GL grand total")
    scalar = graph._resolve_dataset_scalar(
        {"dataset_id": d["id"], "column": "total_hsl"}, "dv")
    direct = dataset.run_dataset(d["graph"])["rows"][0]["total_hsl"]
    assert scalar == direct


def test_dataset_value_under_specified_is_precise_error():
    """No silent default: a dataset_value needs exactly one source, the dataset
    must aggregate to one row, and the column must exist + be numeric."""
    # Neither source -> structural validation error (no DB run).
    bad = {"nodes": [{"id": "dv", "type": "dataset_value", "config": {}},
                     {"id": "out", "type": "output", "config": {}}],
           "edges": [{"source": "dv", "sourceHandle": "out",
                      "target": "out", "targetHandle": "in"}]}
    rep = graph.validate_graph(bad)
    assert not rep["ok"]
    assert any("exactly one of config.graph" in e["message"] for e in rep["errors"])

    # A dataset that yields MANY rows is rejected at resolve time (group-by RCNTR).
    multi = {
        "nodes": [
            {"id": "src", "type": "source",
             "config": {"table": "journal_entries", "columns": ["RCNTR", "HSL"]}},
            {"id": "agg", "type": "aggregate",
             "config": {"group_by": ["RCNTR"],
                        "measures": [{"column": "HSL", "func": "SUM"}]}},
        ],
        "edges": [{"source": "src", "target": "agg"}],
    }
    with pytest.raises(graph.GraphError, match="aggregates to ONE row"):
        graph._resolve_dataset_scalar({"graph": multi, "column": "HSL"}, "dv")

    # An unknown column is a precise error.
    with pytest.raises(graph.GraphError, match="not an output of this dataset"):
        graph._resolve_dataset_scalar(
            {"graph": _journal_total_graph(), "column": "nope"}, "dv")


# ============================================================================
# Allocation bridge — an authored dataset as a pool cost base
# ============================================================================


def test_capture_preview_equals_dataset_sum(db):
    """A capture rule that names a dataset_id captures exactly the dataset's
    SUM(amount_local) to the cent (the dataset IS the deliberate cost base)."""
    d = _activate_dataset(_cost_line_pool_graph(), name="IT-OPS cost base")
    # The dataset's own SUM (the source of truth for the tie-out).
    rows = dataset.run_dataset(d["graph"], sample_limit=10_000)["rows"]
    dataset_sum = sum((Decimal(str(r["amount_local"])) for r in rows), ZERO)
    assert dataset_sum == Decimal("2292280.00")

    captured = runner.preview_capture_rule({"dataset_id": d["id"]})
    assert Decimal(captured["captured_amount"]) == dataset_sum
    assert captured["line_count"] == len(rows)


def test_dataset_sourced_pool_dry_run_zero_residual(db):
    """A pool whose Source stage is a dataset cost base runs the REAL Stages 1-7
    and reconciles to ZERO residual (the engine invariant holds by
    construction), charging out the dataset cost base plus markup."""
    d = _activate_dataset(_cost_line_pool_graph(), name="IT-OPS cost base")
    definition = {
        "name": "Dataset-sourced IT Ops",
        "provider_entity_id": "1000",
        "service_line": "IT",
        "characterization": "Routine-benchmarked",
        "cost_base_definition": "Total services cost",
        "cost_capture_rule": {"dataset_id": d["id"]},
        "beneficiaries": ["3000"],
        "key": {"key_factor": "Equal"},
        "exclusions": [],
        "markup_policies": [{
            "jurisdiction": "DE", "regime": "Benchmarked", "markup_pct": "0.05",
            "benchmark_study_ref": "BM-AP-DS",
        }],
    }
    # The definition validates (a dataset_id satisfies the capture constraint).
    assert authored_pools.validate_definition(definition) == []

    dry = runner.dry_run_authored_pool(definition, pool_id="AP-DS")
    assert dry["balanced"] is True
    assert all(e.get("severity") != "BLOCK" for e in dry["exceptions"])
    # The periods come from the dataset's rows (2026-05 / 2026-11).
    assert dry["periods"] == ["2026-05", "2026-11"]

    # Zero residual on every recon row, and cost recovered == the dataset SUM.
    assert all(r["recon_status"] == "Balanced" for r in dry["recon"])
    assert all(Decimal(r["unallocated_residual"]) == ZERO for r in dry["recon"])
    cost_recovered = sum(
        (Decimal(r["total_cost_recovered"]) for r in dry["recon"]), ZERO)
    assert cost_recovered == Decimal("2292280.00")


def test_dataset_sourced_pool_lifecycle_through_canvas_stage_graph(db):
    """An authored pool built with a dataset_id Source stage tests + activates
    through the unchanged PB2 lifecycle (the dataset is just the cost base)."""
    d = _activate_dataset(_cost_line_pool_graph(), name="IT-OPS cost base")
    definition = {
        "name": "Dataset-sourced IT Ops",
        "provider_entity_id": "1000",
        "service_line": "IT",
        "characterization": "Routine-benchmarked",
        "cost_base_definition": "Total services cost",
        "cost_capture_rule": {"dataset_id": d["id"]},
        "beneficiaries": ["3000"],
        "key": {"key_factor": "Equal"},
        "exclusions": [],
        "markup_policies": [{
            "jurisdiction": "DE", "regime": "Benchmarked", "markup_pct": "0.05",
        }],
    }
    pool = authored_pools.create_authored_pool(definition=definition, actor="maker1")
    res = authored_pools.test_run(pool["id"], actor="maker1")
    assert res["tested"] is True
    assert authored_pools.get_authored_pool(pool["id"])["status"] == "tested"


def test_inactive_dataset_cannot_be_a_cost_base(db):
    """No silent default: a draft / non-active dataset_id is rejected as a pool
    cost base with a precise error (only an ACTIVE dataset resolves)."""
    d = authored_datasets.create_authored_dataset(
        name="Draft cost base", definition=_cost_line_pool_graph(), actor="maker1")
    assert d["status"] == "draft"
    with pytest.raises(ValueError, match="only an ACTIVE authored dataset"):
        runner.dataset_cost_lines(d["id"])
    with pytest.raises(ValueError, match="is unknown"):
        runner.dataset_cost_lines("DS-999")


# ============================================================================
# GOLDEN — the governed allocation is untouched by dataset-sourced pools
# ============================================================================


def test_golden_governed_run_unchanged_by_dataset_sourced_pool(db):
    """The governed demo allocation (actual, all four periods) stays cent-exact
    (FY cost-recovered 13,586,402.70 / FY gross 14,344,773.26) even with an
    ACTIVE dataset-sourced authored pool + an authored run already persisted.
    A dataset-sourced pool is a governed experiment — it never perturbs the
    governed tie-out."""
    d = _activate_dataset(_cost_line_pool_graph(), name="IT-OPS cost base")
    definition = {
        "name": "Dataset-sourced IT Ops",
        "provider_entity_id": "1000",
        "service_line": "IT",
        "characterization": "Routine-benchmarked",
        "cost_base_definition": "Total services cost",
        "cost_capture_rule": {"dataset_id": d["id"]},
        "beneficiaries": ["3000"],
        "key": {"key_factor": "Equal"},
        "exclusions": [],
        "markup_policies": [{
            "jurisdiction": "DE", "regime": "Benchmarked", "markup_pct": "0.05",
        }],
    }
    p = authored_pools.create_authored_pool(definition=definition, actor="maker1")
    authored_pools.test_run(p["id"], actor="maker1")
    authored_pools.submit_for_activation(p["id"], maker="maker1")
    item = next(i for i in review.list_queue("pending")
                if i["record_ref"] == f"allocpool:{p['id']}")
    review.decide(item["id"], checker="checker2", decision="approve")
    # The dataset-sourced authored pool runs on its own overlay (period 2026-05).
    runner.run_authored_allocation(period="2026-05", actor="ops")

    # The GOVERNED allocation must tie out exactly — untouched by the dataset.
    fy_cost = ZERO
    fy_gross = ZERO
    for period in GOVERNED_PERIODS:
        res = runner.run_allocation(period=period, run_type="actual", actor="gov")
        assert res["summary"]["status"] == "succeeded"
        assert res["summary"]["recon_balanced"] is True
        assert res["exception_report"]["exceptions"] == []
        for row in store.list_charges(run_id=res["run_id"]):
            fy_cost += Decimal(row["cost_recovered_amount"])
            fy_gross += Decimal(row["gross_charge_amount"])
    assert fy_cost == Decimal("13586402.70")
    assert fy_gross == Decimal("14344773.26")
