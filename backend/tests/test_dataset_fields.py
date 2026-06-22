"""DS5 — ACDOCA field & value drag-and-drop palette (backend surface).

DS5 widens the journal allowlist to a COMPREHENSIVE, GROUPED set of the ~36
meaningful/populated ACDOCA fields and teaches ``GET /api/dataset/sources`` to
return, per source:

* a grouped ``fields`` list (every field role-tagged, group-labelled,
  provenance-tagged) — the draggable field browser, and
* a ``values`` dict of the actual distinct VALUES of each value-enumerable
  LOW-cardinality dimension (the G/L accounts / cost centers / profit centers /
  … the user asked to drag), capped, with HIGH-cardinality fields excluded.

These tests pin: the widened+grouped field set, the value-enumerable vs
field-only split, and that a filter built from a *dragged value* still compiles
to bound-param SQL (injection-safe) and previews — plus that every widened
amount measure stays Decimal under SUM. The DS1-DS4 tests in ``test_dataset.py``
(and the other dataset suites) remain the back-compat gate.
"""

from __future__ import annotations

from decimal import Decimal

from fastapi.testclient import TestClient

import calc.dataset as dataset
from db import q
from main import app

client = TestClient(app)


def _journal() -> dict:
    cat = client.get("/api/dataset/sources").json()
    return {t["table"]: t for t in cat["tables"]}["journal_entries"]


# --------------------------------------------------------------------------- #
# Widened + grouped field surface
# --------------------------------------------------------------------------- #


def test_journal_exposes_at_least_30_grouped_acdoca_fields_with_provenance():
    je = _journal()
    fields = je["fields"]
    assert len(fields) >= 30                       # comprehensive (~36), not 13
    by_name = {f["name"]: f for f in fields}

    # The dimensions the user explicitly asked for are present + group-labelled.
    for dim in ("RACCT", "RCNTR", "PRCTR", "RBUKRS", "PBUKRS", "LAND1",
                "TAX_COUNTRY", "RASSC", "KOKRS", "RFAREA", "PPRCTR"):
        assert by_name[dim]["role"] == "dimension"
        assert by_name[dim]["group"]               # a non-empty group label
    # The amount measures are present as measures.
    for meas in ("HSL", "KSL", "WSL", "FCSL"):
        assert by_name[meas]["role"] == "measure"

    # Every field carries a real-warehouse provenance tag.
    assert all(f["provenance"] == "real" for f in fields)

    # The fields organise into meaningful groups (the palette renders by group).
    groups = {f["group"] for f in fields}
    for label in ("Entity & partner", "Account", "Cost & profit center",
                  "Amounts", "Currency", "Document", "Dates & period"):
        assert label in groups


def test_grouped_fields_match_back_compat_columns():
    """``fields`` is additive over the pre-existing ``columns`` (same set of
    names + roles) — DS1-DS4 readers of ``columns`` see no regression."""
    je = _journal()
    cols = {c["name"]: c["role"] for c in je["columns"]}
    flds = {f["name"]: f["role"] for f in je["fields"]}
    assert cols == flds
    # ``columns`` now also carries the group label (additive key).
    assert all("group" in c for c in je["columns"])


# --------------------------------------------------------------------------- #
# Value-enumerable (low-cardinality) vs field-only (high-cardinality)
# --------------------------------------------------------------------------- #


def test_journal_values_enumerate_gl_cc_pc_but_not_high_cardinality():
    je = _journal()
    values = je["values"]

    # Low-cardinality dimensions are enumerated with their REAL distinct values.
    assert len(values["RACCT"]) == 17              # the 17 G/L accounts
    assert len(values["RCNTR"]) == 8               # the 8 cost centers
    assert len(values["PRCTR"]) == 8               # the 8 profit centers
    assert "0810000" in values["RACCT"]            # a real account the UI drags

    # High-cardinality / free-text / amount / continuous-date fields are NOT
    # value-enumerated (fields only) — the palette must never list ~50k values.
    for excluded in ("BELNR", "DOCNR_LD", "AWREF", "SGTXT",
                     "HSL", "KSL", "WSL", "FCSL",
                     "BUDAT", "BLDAT", "VALUT", "NETDT"):
        assert excluded not in values


def test_value_lists_are_capped():
    je = _journal()
    assert all(len(vals) <= dataset._VALUE_ENUM_CAP
               for vals in je["values"].values())


def test_other_sources_also_grouped_with_values():
    """Light grouping (DS5) reaches the other four sources, and their
    low-cardinality dimensions are value-enumerated too."""
    cat = client.get("/api/dataset/sources").json()
    by_name = {t["table"]: t for t in cat["tables"]}
    for name in ("segment_pl", "supply_chain_flows", "entity_roles",
                 "allocation_cost_lines"):
        src = by_name[name]
        assert src["fields"], f"{name} has a grouped fields list"
        assert all(f.get("group") for f in src["fields"])
        # At least one dimension is value-enumerable for each source.
        assert src["values"], f"{name} enumerates some dimension values"


# --------------------------------------------------------------------------- #
# A dragged value -> a bound-param filter that compiles + previews (injection)
# --------------------------------------------------------------------------- #


def _value_filter_graph(account: str) -> dict:
    """The graph the canvas builds when a VALUE chip (RACCT=account) is dropped
    on empty canvas: a journal source + a filter with the bound predicate."""
    return {
        "nodes": [
            {"id": "src", "type": "source",
             "config": {"table": "journal_entries",
                        "columns": ["RACCT", "RCNTR", "HSL"]}},
            {"id": "flt", "type": "filter",
             "config": {"predicates": [
                 {"column": "RACCT", "op": "=", "value": account}]}},
        ],
        "edges": [{"source": "src", "target": "flt"}],
    }


def test_dragged_value_filter_compiles_to_bound_param_sql():
    graph = _value_filter_graph("0810000")
    sql, params, cols = dataset.compile_dataset(graph)
    # The literal value is BOUND (a ? param), never interpolated into the SQL.
    assert "0810000" not in sql
    assert "?" in sql
    assert params == ["0810000"]
    assert cols == ["RACCT", "RCNTR", "HSL"]


def test_dragged_value_filter_previews_and_is_injection_safe():
    # A normal value previews and ties to a hand query to the cent.
    graph = _value_filter_graph("0810000")
    p = client.post("/api/dataset/preview", json={"graph": graph}).json()
    assert p["columns"] == ["RACCT", "RCNTR", "HSL"]
    hand_n = q("SELECT COUNT(*) AS n FROM journal WHERE RACCT = ?",
               ["0810000"])[0]["n"]
    assert p["row_count"] == int(hand_n)

    # A SQL-injection payload as the dragged value is treated as a literal: it
    # matches nothing and never escapes the bound parameter (no error, 0 rows).
    evil = "0810000'; DROP TABLE journal; --"
    bad = _value_filter_graph(evil)
    pe = client.post("/api/dataset/preview", json={"graph": bad}).json()
    assert pe["row_count"] == 0
    # The journal is still intact (the DROP never ran — it was a bound value).
    assert q("SELECT COUNT(*) AS n FROM journal")[0]["n"] > 0


# --------------------------------------------------------------------------- #
# Every widened amount measure stays Decimal under SUM
# --------------------------------------------------------------------------- #


def test_each_widened_amount_measure_sums_to_decimal_cent_exact():
    for meas in ("HSL", "KSL", "WSL", "FCSL"):
        graph = {
            "nodes": [
                {"id": "s", "type": "source",
                 "config": {"table": "journal_entries", "columns": ["RBUKRS", meas]}},
                {"id": "a", "type": "aggregate",
                 "config": {"group_by": ["RBUKRS"],
                            "measures": [{"column": meas, "func": "SUM",
                                          "alias": "total"}]}},
            ],
            "edges": [{"source": "s", "target": "a"}],
        }
        out = dataset.run_dataset(graph)
        comp = {r["RBUKRS"]: r["total"] for r in out["rows"]}
        hand = {r["RBUKRS"]: r["total"] for r in q(
            f'SELECT RBUKRS, SUM("{meas}") AS total FROM journal GROUP BY RBUKRS')}
        assert set(comp) == set(hand)
        for k, v in hand.items():
            assert isinstance(comp[k], Decimal)    # money stays Decimal
            assert comp[k] == v                    # cent-exact
