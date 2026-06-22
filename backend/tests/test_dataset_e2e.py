"""DS4 gate — the full dataset loop end-to-end (Phase 8).

This is the spec §DS4 "run the full loop live" pinned as a regression test: on the
cockpit a user builds a dataset over the **real ACDOCA journal**, governs it
through maker-checker, then USES it two ways. The exact loop:

    journal Source
      -> Filter(RACCT IN a base-eroding GL set)
      -> Join(entity_roles on RBUKRS -> jurisdiction)        # the data-prep payoff
      -> Aggregate(group_by RCNTR, PRCTR, jurisdiction; SUM HSL)
      -> Preview (columns / rows / row_count, ties to a hand DuckDB query)
      -> Save (draft)
      -> Test (compile + run -> tested)
      -> submit-activation (-> in_review, one dataset:{id} review item)
      -> approve via review.decide as a DIFFERENT actor (maker != checker)
      -> Active
    then:
      (a) feed a calc: a dataset_value boundary node aggregates the dataset to a
          scalar, an op doubles it, the calc graph previews Decimal-exact;
      (b) set it as an allocation pool cost base: a cost-line-shaped authored
          dataset supplies the Source-stage cost base; preview captures the cost
          and the dry-run reconciles to ZERO residual through the real Stages 1-7.

GOLDEN non-regression: the governed demo allocation (actual, all four periods)
stays cent-exact — FY cost-recovered $13,586,402.70 / gross $14,344,773.26 — even
with the active authored dataset + a dataset-sourced authored pool present. The
dataset layer is a visual data-prep surface over the SAME DuckDB engine; it never
perturbs the governed tie-out.

NO float arithmetic on money anywhere (Decimal only).

Run from backend/:  ../.venv/bin/python -m pytest tests/test_dataset_e2e.py
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
from db import q

ZERO = Decimal("0")
GOVERNED_PERIODS = ["2026-04", "2026-05", "2026-10", "2026-11"]

# A real base-eroding GL set (management / shared-service accounts that carry both
# a cost center and a profit center in the ACDOCA journal). The numbers below are
# the live warehouse figures — this test is the e2e tie-out, so they are pinned.
GL_SET = ["0900000", "0910000", "0930000"]
JOURNAL_GL_SET_TOTAL = Decimal("18968655.36")


@pytest.fixture()
def db(tmp_path):
    """Isolated SQLite state DB per test (authored datasets + pools live here)."""
    engine.configure(tmp_path / "state.db")
    engine.init_db()
    yield
    engine.close()


# --------------------------------------------------------------------------- #
# The DS4 loop dataset — journal -> filter -> JOIN entity_roles -> aggregate
# --------------------------------------------------------------------------- #


def _acdoca_jurisdiction_graph() -> dict:
    """The spec's DS4 dataset: filter the journal to a base-eroding GL set, LEFT
    JOIN entity_roles (RBUKRS) to bring jurisdiction (LAND1) onto each line, then
    aggregate SUM(HSL) by cost center / profit center / jurisdiction. The JOIN is
    the data-prep payoff the user asked for (enrich ACDOCA with a dimension that
    only lives on another source)."""
    return {
        "nodes": [
            {"id": "jrnl", "type": "source",
             "config": {"table": "journal_entries",
                        "columns": ["RBUKRS", "RACCT", "RCNTR", "PRCTR", "HSL"]}},
            {"id": "flt", "type": "filter",
             "config": {"predicates": [
                 {"column": "RACCT", "op": "IN", "values": GL_SET}]}},
            {"id": "roles", "type": "source",
             "config": {"table": "entity_roles",
                        "columns": ["RBUKRS", "LAND1", "ROLE_CODE"]}},
            {"id": "jn", "type": "join",
             "config": {"how": "LEFT",
                        "on": [{"left": "RBUKRS", "right": "RBUKRS"}],
                        "select": [
                            {"side": "left", "column": "RCNTR"},
                            {"side": "left", "column": "PRCTR"},
                            {"side": "left", "column": "HSL"},
                            {"side": "right", "column": "LAND1",
                             "alias": "jurisdiction"},
                        ]}},
            {"id": "agg", "type": "aggregate",
             "config": {"group_by": ["RCNTR", "PRCTR", "jurisdiction"],
                        "measures": [{"column": "HSL", "func": "SUM",
                                      "alias": "cost"}]}},
        ],
        "edges": [
            {"source": "jrnl", "target": "flt"},
            {"source": "flt", "target": "jn"},
            {"source": "roles", "target": "jn"},
            {"source": "jn", "target": "agg"},
        ],
    }


def _grand_total_graph() -> dict:
    """The same filtered journal aggregated to ONE scalar (SUM HSL) — the calc
    bridge's single-value source."""
    return {
        "nodes": [
            {"id": "jrnl", "type": "source",
             "config": {"table": "journal_entries", "columns": ["RACCT", "HSL"]}},
            {"id": "flt", "type": "filter",
             "config": {"predicates": [
                 {"column": "RACCT", "op": "IN", "values": GL_SET}]}},
            {"id": "agg", "type": "aggregate",
             "config": {"group_by": [],
                        "measures": [{"column": "HSL", "func": "SUM",
                                      "alias": "base_erosion"}]}},
        ],
        "edges": [
            {"source": "jrnl", "target": "flt"},
            {"source": "flt", "target": "agg"},
        ],
    }


def _cost_base_dataset_graph() -> dict:
    """A cost-line-shaped dataset over the fabricated allocation cost lines (the
    finer real-shaped cost-center grain): filter provider 1000 / actual ledger /
    two IT-OPS cost centers, then project the engine's cost-line columns. SUM =
    2,292,280.00 — the pool cost base for the allocation bridge."""
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


def _govern_dataset(graph_def: dict, *, name: str,
                    maker: str = "u_maria", checker: str = "u_sam") -> dict:
    """Drive a dataset through the FULL maker-checker loop and assert each
    transition: create(draft) -> test(tested) -> submit(in_review) -> a DIFFERENT
    actor approves via review.decide -> active. Returns the active record."""
    d = authored_datasets.create_authored_dataset(
        name=name, definition=graph_def, actor=maker)
    assert d["status"] == "draft"

    tested = authored_datasets.test_run(d["id"], actor=maker)
    assert tested["tested"] is True
    assert authored_datasets.get_authored_dataset(d["id"])["status"] == "tested"

    authored_datasets.submit_for_activation(d["id"], maker=maker)
    assert authored_datasets.get_authored_dataset(d["id"])["status"] == "in_review"

    item = next(i for i in review.list_queue("pending")
                if i["record_ref"] == f"dataset:{d['id']}")
    # Maker cannot approve their own dataset (segregation of duties).
    with pytest.raises(ValueError):
        review.decide(item["id"], checker=maker, decision="approve")
    review.decide(item["id"], checker=checker, decision="approve")

    active = authored_datasets.get_authored_dataset(d["id"])
    assert active["status"] == "active"
    assert active["activated_by"] == checker
    return active


# ============================================================================
# The loop, end to end
# ============================================================================


def test_ds4_full_loop_build_govern_and_use(db):
    """The whole DS4 story in one test: build the ACDOCA join/filter/aggregate
    dataset, preview it (ties to a hand query), govern it through maker-checker,
    then USE it as a calc input AND as an allocation pool cost base — all while
    the governed allocation stays cent-exact."""
    g = _acdoca_jurisdiction_graph()

    # --- Validate + preview (pure reads, nothing persists) ------------------
    rep = dataset.validate_dataset(g)
    assert rep["ok"], rep["errors"]
    assert rep["output_columns"] == ["RCNTR", "PRCTR", "jurisdiction", "cost"]

    preview = dataset.run_dataset(g)
    assert preview["columns"] == ["RCNTR", "PRCTR", "jurisdiction", "cost"]
    assert preview["row_count"] == 8  # 8 (cost center, profit center) groups
    # The aggregate ties out to a hand DuckDB query on the same GL set, to the cent.
    preview_total = sum(
        (Decimal(str(r["cost"])) for r in preview["rows"]), ZERO)
    hand = q("SELECT SUM(HSL) AS t FROM journal WHERE RACCT IN (?, ?, ?)", GL_SET)
    assert Decimal(str(hand[0]["t"])) == JOURNAL_GL_SET_TOTAL
    assert preview_total == JOURNAL_GL_SET_TOTAL
    # Money stays Decimal end-to-end (no float on amounts).
    assert all(isinstance(r["cost"], Decimal) for r in preview["rows"])
    # The JOIN actually enriched every row with a real jurisdiction (not null).
    assert all(r["jurisdiction"] for r in preview["rows"])
    assert {"US", "CH", "DE"} <= {r["jurisdiction"] for r in preview["rows"]}

    # --- Save -> Test -> submit -> approve (different actor) -> Active -------
    active = _govern_dataset(g, name="ACDOCA base-erosion by CC/PC/jurisdiction")

    # An ACTIVE dataset is now referenceable as a dataset/{id} source.
    sources = dataset.active_dataset_sources()
    assert any(s["dataset_id"] == active["id"] for s in sources)
    src = next(s for s in sources if s["dataset_id"] == active["id"])
    assert src["provenance"] == "authored"
    assert src["table"] == f"dataset/{active['id']}"
    # The active dataset resolves as a source in another dataset (the bridge).
    via_source = dataset.run_dataset({
        "nodes": [{"id": "s", "type": "source",
                   "config": {"table": f"dataset/{active['id']}"}}],
        "edges": [],
    })
    assert via_source["row_count"] == 8
    assert sum((Decimal(str(r["cost"])) for r in via_source["rows"]), ZERO) \
        == JOURNAL_GL_SET_TOTAL


def test_ds4_dataset_feeds_a_calc(db):
    """(a) Feed a calc: a governed dataset aggregated to a scalar flows through a
    dataset_value boundary node, an op doubles it, and the calc graph previews
    Decimal-exact — the journal-grained GL number reaching a formula calc."""
    active = _govern_dataset(_grand_total_graph(), name="GL base-erosion total")

    # The dataset's own scalar (the source of truth for the tie-out).
    direct = dataset.run_dataset(active["graph"])
    assert direct["row_count"] == 1
    scalar = direct["rows"][0]["base_erosion"]
    assert scalar == JOURNAL_GL_SET_TOTAL
    assert isinstance(scalar, Decimal)

    # A calc graph: dataset_value (the active dataset) * 2 -> output.
    calc_graph = {
        "nodes": [
            {"id": "dv", "type": "dataset_value",
             "config": {"dataset_id": active["id"], "column": "base_erosion"}},
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
    # The dataset scalar lands as an exact Decimal literal (no float).
    assert str(scalar) in expression
    value = expr.evaluate(expression)
    assert value == scalar * Decimal("2")
    assert isinstance(value, Decimal)

    # The per-node preview paints the dataset_value node with the exact scalar.
    node_exprs = graph.node_exprs(calc_graph)
    assert expr.evaluate(node_exprs["dv"]) == scalar


def test_ds4_dataset_is_a_pool_cost_base(db):
    """(b) Set it as an allocation pool cost base: a cost-line-shaped governed
    dataset supplies the Source-stage cost base; the capture preview equals the
    dataset's SUM, and the dry-run reconciles to ZERO residual through the real
    Stages 1-7 (the user built a cost pool by filtering ACDOCA-grained lines)."""
    active = _govern_dataset(_cost_base_dataset_graph(), name="IT-OPS cost base")

    # The dataset's own SUM is the cost base (source of truth for the tie-out).
    rows = dataset.run_dataset(active["graph"], sample_limit=10_000)["rows"]
    dataset_sum = sum((Decimal(str(r["amount_local"])) for r in rows), ZERO)
    assert dataset_sum == Decimal("2292280.00")

    rule = {"dataset_id": active["id"]}
    captured = runner.preview_capture_rule(rule)
    assert Decimal(captured["captured_amount"]) == dataset_sum
    assert captured["line_count"] == len(rows)

    definition = {
        "name": "Dataset-sourced IT Ops",
        "provider_entity_id": "1000",
        "service_line": "IT",
        "characterization": "Routine-benchmarked",
        "cost_base_definition": "Total services cost",
        "cost_capture_rule": rule,
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

    dry = runner.dry_run_authored_pool(definition, pool_id="AP-DS4")
    assert dry["balanced"] is True
    assert all(e.get("severity") != "BLOCK" for e in dry["exceptions"])
    # Zero residual on every recon row; recovered cost == the dataset SUM.
    assert all(r["recon_status"] == "Balanced" for r in dry["recon"])
    assert all(Decimal(r["unallocated_residual"]) == ZERO for r in dry["recon"])
    cost_recovered = sum(
        (Decimal(r["total_cost_recovered"]) for r in dry["recon"]), ZERO)
    assert cost_recovered == dataset_sum


def test_ds4_governed_allocation_stays_cent_exact(db):
    """GOLDEN: with BOTH an active ACDOCA dataset and a dataset-sourced authored
    pool (run on its own overlay) present, the governed allocation (actual, all
    four periods) is still cent-exact — FY $13,586,402.70 cost / $14,344,773.26
    gross. The dataset layer never perturbs the governed tie-out."""
    # An active ACDOCA dataset (feeds calcs) — present but irrelevant to the run.
    _govern_dataset(_acdoca_jurisdiction_graph(),
                    name="ACDOCA base-erosion by CC/PC/jurisdiction")
    # An active dataset-sourced authored pool, run on its own overlay.
    cost_base = _govern_dataset(_cost_base_dataset_graph(), name="IT-OPS cost base")
    definition = {
        "name": "Dataset-sourced IT Ops",
        "provider_entity_id": "1000",
        "service_line": "IT",
        "characterization": "Routine-benchmarked",
        "cost_base_definition": "Total services cost",
        "cost_capture_rule": {"dataset_id": cost_base["id"]},
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


def test_ds4_provenance_separates_real_acdoca_from_fabricated_cost_lines(db):
    """The provenance dashboard story: the dataset palette tags the real ACDOCA
    journal source 'real' and the fabricated allocation cost_lines 'fabricated' —
    distinct, never silently mixed — and the catalog's provenance rollup carries
    the same classification (so the Provenance tab shows both honestly)."""
    catalogue = dataset.sources_catalog()
    by_table = {t["table"]: t for t in catalogue["tables"]}
    assert by_table["journal_entries"]["provenance"] == "real"
    assert by_table["allocation_cost_lines"]["provenance"] == "fabricated"
    # The journal exposes the GL / CC / PC value lists the user asked to see.
    assert catalogue["journal_distinct"]["RACCT"]
    assert catalogue["journal_distinct"]["RCNTR"]
    assert catalogue["journal_distinct"]["PRCTR"]

    # And the governed data-catalog rollup agrees on both sources' provenance.
    from services import catalog as catalog_svc
    rollup = catalog_svc.provenance_rollup()
    real_ids = {i["id"] for i in rollup["buckets"]["real"]["items"]}
    fab_ids = {i["id"] for i in rollup["buckets"]["fabricated"]["items"]}
    assert "warehouse:journal" in real_ids
    assert "seed:allocation_cost_lines" in fab_ids
