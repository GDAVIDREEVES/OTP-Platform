"""TDD for the dataset / data-prep compiler + source registry (Phase 8 DS1).

The dataset layer is the data-prep generalization of ``calc/expr.py`` — a graph
of ``source / filter / aggregate / join / union / derive / select`` nodes
compiles to ONE safe parameterized DuckDB query (a CTE chain) run via
``db.q``. DuckDB stays the engine; there is no new evaluator. These tests pin:

* **Cent-exact tie-out** — a journal ``source -> filter(RACCT IN […]) ->
  aggregate(group_by RCNTR,PRCTR; SUM HSL)`` compiles to SQL whose result equals
  a hand-written ``db.q`` over ``journal`` to the CENT on HSL (Decimal money).
* **Join** — journal × entity_roles on ``RBUKRS`` returns the selected columns.
* **Injection-safety** — a non-allowlisted column, an op-as-value, and an
  unknown source are REJECTED by ``validate_dataset`` with NO SQL emitted; and
  filter values are BOUND parameters (the compiled ``params`` list carries the
  literals — they are never interpolated into the SQL string).
* **Fabricated source** — ``allocation_cost_lines`` is queryable and flagged
  ``fabricated`` in the catalog.
* **Sources catalog** — lists all 5 sources with provenance + the journal's real
  distinct GL(17) / CC / PC value lists.

Run from ``backend/``:  python -m pytest tests/test_dataset.py
"""

from __future__ import annotations

from decimal import Decimal

from fastapi.testclient import TestClient

import calc.dataset as dataset
from db import q
from main import app

client = TestClient(app)


# A few real GL accounts to filter on (taken from the warehouse, not invented).
def _sample_accts(n: int = 3) -> list[str]:
    return [r["RACCT"] for r in
            q(f"SELECT DISTINCT RACCT FROM journal ORDER BY RACCT LIMIT {n}")]


def _journal_filter_aggregate_graph(accts: list[str]) -> dict:
    """journal source -> filter(RACCT IN accts) -> aggregate(group RCNTR,PRCTR; SUM HSL)."""
    return {
        "nodes": [
            {"id": "src", "type": "source",
             "config": {"table": "journal_entries",
                        "columns": ["RACCT", "RCNTR", "PRCTR", "HSL"]}},
            {"id": "flt", "type": "filter",
             "config": {"predicates": [{"column": "RACCT", "op": "IN", "values": accts}]}},
            {"id": "agg", "type": "aggregate",
             "config": {"group_by": ["RCNTR", "PRCTR"],
                        "measures": [{"column": "HSL", "func": "SUM"}]}},
        ],
        "edges": [
            {"source": "src", "target": "flt"},
            {"source": "flt", "target": "agg"},
        ],
    }


# --------------------------------------------------------------------------- #
# Cent-exact tie-out (Decimal money)
# --------------------------------------------------------------------------- #


def test_filter_aggregate_ties_to_hand_query_to_the_cent():
    accts = _sample_accts(3)
    graph = _journal_filter_aggregate_graph(accts)

    out = dataset.run_dataset(graph)
    assert out["columns"] == ["RCNTR", "PRCTR", "HSL"]

    # Hand-written reference over the registered journal view.
    placeholders = ", ".join("?" for _ in accts)
    hand = q(
        f"SELECT RCNTR, PRCTR, SUM(HSL) AS HSL FROM journal "
        f"WHERE RACCT IN ({placeholders}) GROUP BY RCNTR, PRCTR",
        accts,
    )
    hand_map = {(r["RCNTR"], r["PRCTR"]): r["HSL"] for r in hand}
    comp_map = {(r["RCNTR"], r["PRCTR"]): r["HSL"] for r in out["rows"]}

    assert set(comp_map) == set(hand_map)
    assert out["row_count"] == len(hand_map)
    for key, hand_val in hand_map.items():
        comp_val = comp_map[key]
        assert isinstance(comp_val, Decimal)        # money stays Decimal
        assert isinstance(hand_val, Decimal)
        assert comp_val == hand_val                 # cent-exact


def test_aggregate_measure_alias_and_count():
    graph = {
        "nodes": [
            {"id": "s", "type": "source", "config": {"table": "journal_entries"}},
            {"id": "a", "type": "aggregate",
             "config": {"group_by": ["RBUKRS"],
                        "measures": [
                            {"column": "HSL", "func": "SUM", "alias": "total_hsl"},
                            {"func": "COUNT", "alias": "n_lines"},
                        ]}},
        ],
        "edges": [{"source": "s", "target": "a"}],
    }
    out = dataset.run_dataset(graph)
    assert out["columns"] == ["RBUKRS", "total_hsl", "n_lines"]
    hand = q("SELECT RBUKRS, SUM(HSL) AS total_hsl, COUNT(*) AS n_lines "
             "FROM journal GROUP BY RBUKRS")
    hand_map = {r["RBUKRS"]: (r["total_hsl"], r["n_lines"]) for r in hand}
    for r in out["rows"]:
        assert isinstance(r["total_hsl"], Decimal)
        assert (r["total_hsl"], r["n_lines"]) == hand_map[r["RBUKRS"]]


# --------------------------------------------------------------------------- #
# Join
# --------------------------------------------------------------------------- #


def test_journal_entity_roles_join_returns_expected_columns():
    graph = {
        "nodes": [
            {"id": "j", "type": "source",
             "config": {"table": "journal_entries", "columns": ["RBUKRS", "HSL"]}},
            {"id": "ja", "type": "aggregate",
             "config": {"group_by": ["RBUKRS"],
                        "measures": [{"column": "HSL", "func": "SUM"}]}},
            {"id": "e", "type": "source",
             "config": {"table": "entity_roles",
                        "columns": ["RBUKRS", "ROLE_CODE", "ROLE_DESCRIPTION"]}},
            {"id": "jn", "type": "join",
             "config": {"how": "INNER",
                        "on": [{"left": "RBUKRS", "right": "RBUKRS"}],
                        "select": [
                            {"side": "left", "column": "RBUKRS"},
                            {"side": "left", "column": "HSL", "alias": "total_hsl"},
                            {"side": "right", "column": "ROLE_CODE"},
                        ]}},
        ],
        "edges": [
            {"source": "j", "target": "ja"},
            {"source": "ja", "target": "jn"},   # left input (declared first)
            {"source": "e", "target": "jn"},    # right input
        ],
    }
    out = dataset.run_dataset(graph)
    assert out["columns"] == ["RBUKRS", "total_hsl", "ROLE_CODE"]
    assert out["row_count"] > 0
    for r in out["rows"]:
        assert isinstance(r["total_hsl"], Decimal)
        assert r["ROLE_CODE"] is not None


# --------------------------------------------------------------------------- #
# Injection-safety — allowlist enforced, values bound, NO SQL on a bad graph
# --------------------------------------------------------------------------- #


def test_non_allowlisted_source_column_is_rejected_no_sql():
    graph = {
        "nodes": [
            {"id": "s", "type": "source",
             "config": {"table": "journal_entries",
                        "columns": ["RACCT", "HSL; DROP TABLE journal"]}},
        ],
        "edges": [],
    }
    report = dataset.validate_dataset(graph)
    assert report["ok"] is False
    assert report["output_columns"] == []
    assert any("not a column" in e["message"] for e in report["errors"])
    # compile_dataset raises (no SQL string is produced for the bad graph)
    try:
        dataset.compile_dataset(graph)
        assert False, "expected DatasetError"
    except dataset.DatasetError as e:
        assert e.node_id == "s"


def test_op_as_value_is_rejected():
    # An attacker tries to smuggle SQL through the op slot; ops are allowlisted.
    graph = {
        "nodes": [
            {"id": "s", "type": "source", "config": {"table": "journal_entries"}},
            {"id": "f", "type": "filter",
             "config": {"predicates": [
                 {"column": "RACCT", "op": "= '' OR 1=1 --", "value": "x"}]}},
        ],
        "edges": [{"source": "s", "target": "f"}],
    }
    report = dataset.validate_dataset(graph)
    assert report["ok"] is False
    assert any("is not allowed" in e["message"] for e in report["errors"])


def test_unknown_source_table_is_rejected():
    graph = {
        "nodes": [{"id": "s", "type": "source",
                   "config": {"table": "secrets; DROP TABLE journal"}}],
        "edges": [],
    }
    report = dataset.validate_dataset(graph)
    assert report["ok"] is False
    assert any("unknown source table" in e["message"] for e in report["errors"])


def test_filter_values_are_bound_parameters_not_interpolated():
    accts = _sample_accts(2)
    sentinel = "x' OR '1'='1"   # a value that would be catastrophic if interpolated
    graph = {
        "nodes": [
            {"id": "s", "type": "source", "config": {"table": "journal_entries"}},
            {"id": "f", "type": "filter",
             "config": {"predicates": [
                 {"column": "RACCT", "op": "IN", "values": accts},
                 {"column": "SGTXT", "op": "=", "value": sentinel},
             ]}},
        ],
        "edges": [{"source": "s", "target": "f"}],
    }
    sql, params, _cols = dataset.compile_dataset(graph)
    # Every literal is a bound parameter; none appear in the SQL text.
    assert params == accts + [sentinel]
    assert sentinel not in sql
    for a in accts:
        assert a not in sql
    # Bound placeholders are present instead.
    assert sql.count("?") == len(params)


def test_cycle_is_rejected():
    graph = {
        "nodes": [
            {"id": "a", "type": "filter",
             "config": {"predicates": [{"column": "RACCT", "op": "=", "value": "x"}]}},
            {"id": "b", "type": "filter",
             "config": {"predicates": [{"column": "RACCT", "op": "=", "value": "y"}]}},
        ],
        "edges": [{"source": "a", "target": "b"}, {"source": "b", "target": "a"}],
    }
    report = dataset.validate_dataset(graph)
    assert report["ok"] is False
    assert any("cycle" in e["message"] for e in report["errors"])


def test_union_schema_mismatch_is_rejected():
    graph = {
        "nodes": [
            {"id": "a", "type": "source",
             "config": {"table": "journal_entries", "columns": ["RBUKRS", "HSL"]}},
            {"id": "b", "type": "source",
             "config": {"table": "journal_entries", "columns": ["RBUKRS"]}},
            {"id": "u", "type": "union", "config": {}},
        ],
        "edges": [{"source": "a", "target": "u"}, {"source": "b", "target": "u"}],
    }
    report = dataset.validate_dataset(graph)
    assert report["ok"] is False
    assert any("incompatible schema" in e["message"] for e in report["errors"])


def test_under_specified_aggregate_is_rejected_no_silent_default():
    graph = {
        "nodes": [
            {"id": "s", "type": "source", "config": {"table": "journal_entries"}},
            {"id": "a", "type": "aggregate", "config": {"group_by": ["RBUKRS"]}},
        ],
        "edges": [{"source": "s", "target": "a"}],
    }
    report = dataset.validate_dataset(graph)
    assert report["ok"] is False
    assert any("at least one measure" in e["message"] for e in report["errors"])


# --------------------------------------------------------------------------- #
# Union / derive / select happy paths
# --------------------------------------------------------------------------- #


def test_union_all_stacks_compatible_relations():
    accts = _sample_accts(4)
    graph = {
        "nodes": [
            {"id": "a", "type": "source",
             "config": {"table": "journal_entries", "columns": ["RBUKRS", "HSL"]}},
            {"id": "fa", "type": "filter",
             "config": {"predicates": [{"column": "RBUKRS", "op": "=", "value": "1000"}]}},
            {"id": "b", "type": "source",
             "config": {"table": "journal_entries", "columns": ["RBUKRS", "HSL"]}},
            {"id": "fb", "type": "filter",
             "config": {"predicates": [{"column": "RBUKRS", "op": "=", "value": "3100"}]}},
            {"id": "u", "type": "union", "config": {}},
        ],
        "edges": [
            {"source": "a", "target": "fa"},
            {"source": "b", "target": "fb"},
            {"source": "fa", "target": "u"},
            {"source": "fb", "target": "u"},
        ],
    }
    out = dataset.run_dataset(graph)
    assert out["columns"] == ["RBUKRS", "HSL"]
    hand = q("SELECT COUNT(*) AS n FROM journal WHERE RBUKRS IN ('1000', '3100')")
    assert out["row_count"] == hand[0]["n"]


def test_derive_computed_column_is_bound_and_correct():
    graph = {
        "nodes": [
            {"id": "s", "type": "source",
             "config": {"table": "journal_entries", "columns": ["RBUKRS", "HSL"]}},
            {"id": "a", "type": "aggregate",
             "config": {"group_by": ["RBUKRS"],
                        "measures": [{"column": "HSL", "func": "SUM", "alias": "hsl"}]}},
            {"id": "d", "type": "derive",
             "config": {"alias": "hsl_k", "left": {"column": "hsl"},
                        "op": "/", "right": {"const": 1000}}},
        ],
        "edges": [
            {"source": "s", "target": "a"},
            {"source": "a", "target": "d"},
        ],
    }
    sql, params, cols = dataset.compile_dataset(graph)
    assert cols == ["RBUKRS", "hsl", "hsl_k"]
    assert "1000" in params               # the constant is bound, not inlined
    assert "1000" not in sql              # never interpolated into the SQL text
    out = dataset.run_dataset(graph)
    for r in out["rows"]:
        assert isinstance(r["hsl_k"], Decimal)        # derived money stays Decimal
        assert r["hsl_k"] == (r["hsl"] / 1000).quantize(Decimal("0.00000001"))


def test_select_projects_columns():
    graph = {
        "nodes": [
            {"id": "s", "type": "source", "config": {"table": "entity_roles"}},
            {"id": "p", "type": "select",
             "config": {"columns": ["RBUKRS", "ROLE_CODE"]}},
        ],
        "edges": [{"source": "s", "target": "p"}],
    }
    out = dataset.run_dataset(graph)
    assert out["columns"] == ["RBUKRS", "ROLE_CODE"]


# --------------------------------------------------------------------------- #
# Fabricated cost_lines source + sources catalog
# --------------------------------------------------------------------------- #


def test_allocation_cost_lines_source_is_queryable_and_fabricated():
    graph = {
        "nodes": [
            {"id": "s", "type": "source", "config": {"table": "allocation_cost_lines"}},
            {"id": "a", "type": "aggregate",
             "config": {"group_by": ["provider_entity_id", "ledger"],
                        "measures": [{"column": "amount_local", "func": "SUM",
                                      "alias": "amount"}]}},
        ],
        "edges": [{"source": "s", "target": "a"}],
    }
    out = dataset.run_dataset(graph)
    assert out["row_count"] > 0
    for r in out["rows"]:
        assert isinstance(r["amount"], Decimal)   # fabricated, but still Decimal money

    # The cost_lines source is provenance-flagged fabricated.
    assert dataset.DATASET_TABLES["allocation_cost_lines"]["provenance"] == "fabricated"


def test_sources_catalog_lists_all_five_with_provenance_and_journal_distincts():
    cat = client.get("/api/dataset/sources").json()
    by_name = {t["table"]: t for t in cat["tables"]}
    assert set(by_name) == {
        "journal_entries", "segment_pl", "supply_chain_flows",
        "entity_roles", "allocation_cost_lines",
    }
    # provenance: the four warehouse views are real; cost_lines is fabricated.
    assert by_name["journal_entries"]["provenance"] == "real"
    assert by_name["segment_pl"]["provenance"] == "real"
    assert by_name["supply_chain_flows"]["provenance"] == "real"
    assert by_name["entity_roles"]["provenance"] == "real"
    assert by_name["allocation_cost_lines"]["provenance"] == "fabricated"

    # The journal exposes the ACDOCA dimensions + measures the user asked for.
    jcols = {c["name"]: c for c in by_name["journal_entries"]["columns"]}
    for dim in ("RBUKRS", "RACCT", "RCNTR", "PRCTR", "GJAHR", "POPER",
                "SEGMENT", "BLART", "DRCRK"):
        assert jcols[dim]["role"] == "dimension"
    assert jcols["HSL"]["role"] == "measure"

    # Real distinct GL/CC/PC value lists are surfaced for the palette.
    distinct = cat["journal_distinct"]
    assert len(distinct["RACCT"]) == 17        # the gate's GL(17)
    assert len(distinct["RCNTR"]) >= 1
    assert len(distinct["PRCTR"]) >= 1


def test_validate_endpoint_ok_and_preview_endpoint_runs():
    accts = _sample_accts(2)
    graph = _journal_filter_aggregate_graph(accts)

    v = client.post("/api/dataset/validate", json={"graph": graph}).json()
    assert v["ok"] is True
    assert v["output_columns"] == ["RCNTR", "PRCTR", "HSL"]

    p = client.post("/api/dataset/preview",
                    json={"graph": graph, "sample_limit": 50}).json()
    assert p["columns"] == ["RCNTR", "PRCTR", "HSL"]
    assert p["row_count"] >= 1

    # A bad graph returns a precise 400 from the preview endpoint (no SQL run).
    bad = {"nodes": [{"id": "s", "type": "source",
                      "config": {"table": "nope"}}], "edges": []}
    r = client.post("/api/dataset/preview", json={"graph": bad})
    assert r.status_code == 400
    assert "unknown source table" in r.json()["detail"]["message"]
