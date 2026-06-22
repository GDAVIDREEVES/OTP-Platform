"""TDD for the authored-dataset lifecycle + dataset-as-source (Phase 8 DS2).

An authored dataset is a user-built data-prep graph (source / filter / aggregate
/ join / union / derive / select) that compiles to ONE safe parameterized DuckDB
query (calc/dataset.py — DuckDB stays the engine). It is the dataset analogue of
the authored_pools / user_calculations governed objects. The keystones pinned
here:

* **Lifecycle** — draft -> tested (a successful compile+run of the CURRENT graph
  is the gate) -> in_review (maker submits) -> active (a DIFFERENT checker
  approves), every transition hash-chained at dataset:{id}.
* **Maker-checker** — activation rides the existing review queue via the new
  ``dataset:`` branch in review.decide(); the maker cannot approve their own
  dataset; rejection returns it to draft.
* **Tested-hash gate** — an edited graph cannot be submitted until re-tested
  (the gate is the sha256 of the canonical graph, not the status flag).
* **Dataset-as-source** — an ACTIVE dataset resolves as a ``dataset/{id}``
  source in another dataset's preview (the dataset bridge); a draft / non-active
  dataset is REJECTED as a source with a precise error; a reference cycle is
  caught. Money stays Decimal through the inlined subquery.
* **Preview / validate persist nothing** — no row, no audit event.

Run from ``backend/``:  python -m pytest tests/test_authored_datasets.py
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

import calc.dataset as dataset
import state.audit as audit
import state.authored_datasets as authored_datasets
import state.review as review
from db import q
from main import app

client = TestClient(app)


# --- Graph fixtures (real warehouse columns, not invented) ---------------------


def _journal_agg_graph() -> dict:
    """journal source -> aggregate(group RCNTR; SUM HSL) — a small valid dataset."""
    return {
        "nodes": [
            {"id": "src", "type": "source",
             "config": {"table": "journal_entries", "columns": ["RCNTR", "HSL"]}},
            {"id": "agg", "type": "aggregate",
             "config": {"group_by": ["RCNTR"],
                        "measures": [{"column": "HSL", "func": "SUM"}]}},
        ],
        "edges": [{"source": "src", "target": "agg"}],
    }


def _journal_pc_agg_graph() -> dict:
    """A DIFFERENT valid graph (group by PRCTR) — for edit/invalidate tests."""
    return {
        "nodes": [
            {"id": "src", "type": "source",
             "config": {"table": "journal_entries", "columns": ["PRCTR", "HSL"]}},
            {"id": "agg", "type": "aggregate",
             "config": {"group_by": ["PRCTR"],
                        "measures": [{"column": "HSL", "func": "SUM"}]}},
        ],
        "edges": [{"source": "src", "target": "agg"}],
    }


def _dataset_source_graph(dataset_id: str) -> dict:
    """A dataset that SOURCES another authored dataset (the bridge) and filters it."""
    return {
        "nodes": [
            {"id": "ds", "type": "source",
             "config": {"table": f"dataset/{dataset_id}"}},
            {"id": "sel", "type": "select", "config": {"columns": ["RCNTR", "HSL"]}},
        ],
        "edges": [{"source": "ds", "target": "sel"}],
    }


def _create(actor: str = "u_maria", name: str = "GL by cost center",
            graph: dict | None = None) -> dict:
    return authored_datasets.create_authored_dataset(
        name=name, definition=graph or _journal_agg_graph(), actor=actor,
        description="Journal HSL grouped by cost center",
    )


def _pending_item(did: str) -> dict:
    return next(i for i in review.list_queue()
               if i["record_ref"] == f"dataset:{did}")


def _activated(maker: str = "u_maria", checker: str = "u_sam",
               name: str = "GL by cost center", graph: dict | None = None) -> dict:
    d = _create(actor=maker, name=name, graph=graph)
    authored_datasets.test_run(d["id"], actor=maker)
    authored_datasets.submit_for_activation(d["id"], maker=maker)
    review.decide(_pending_item(d["id"])["id"], checker=checker, decision="approve")
    return authored_datasets.get_authored_dataset(d["id"])


# --- Create / update -----------------------------------------------------------


def test_create_draft_audited(state_db):
    d = _create()
    assert d["id"] == "DS-1"
    assert d["status"] == "draft"
    assert d["version"] == 1
    assert d["tested_graph_hash"] is None
    assert d["graph"] == _journal_agg_graph()
    events = audit.list_events(record_ref="dataset:DS-1")
    assert any(e["event_type"] == "created" and e["actor"] == "u_maria"
               for e in events)
    assert audit.verify_chain()["ok"]


def test_create_rejects_invalid_graph(state_db):
    with pytest.raises(ValueError, match="invalid authored dataset"):
        _create(graph={"nodes": [
            {"id": "src", "type": "source",
             "config": {"table": "journal_entries", "columns": ["NOPE"]}}],
            "edges": []})
    with pytest.raises(ValueError, match="name is required"):
        authored_datasets.create_authored_dataset(
            name="  ", definition=_journal_agg_graph(), actor="u_maria")


def test_update_draft_invalidates_test(state_db):
    d = _create()
    authored_datasets.test_run(d["id"], actor="u_maria")
    assert authored_datasets.get_authored_dataset(d["id"])["status"] == "tested"
    # Changing the graph returns it to draft and clears the hash gate.
    after = authored_datasets.update_authored_dataset(
        d["id"], actor="u_maria", definition=_journal_pc_agg_graph())
    assert after["status"] == "draft"
    assert after["tested_graph_hash"] is None
    assert after["version"] == 1  # a draft edit keeps the version


# --- Test gate -----------------------------------------------------------------


def test_test_run_marks_tested_and_returns_preview(state_db):
    d = _create()
    out = authored_datasets.test_run(d["id"], actor="u_maria")
    assert out["tested"] is True
    assert set(out["result"]["columns"]) == {"RCNTR", "HSL"}
    assert out["result"]["row_count"] >= 1
    assert authored_datasets.get_authored_dataset(d["id"])["status"] == "tested"


def test_untested_edit_cannot_submit(state_db):
    d = _create()
    authored_datasets.test_run(d["id"], actor="u_maria")
    # Edit AFTER test -> draft; the hash gate blocks submission until re-tested.
    authored_datasets.update_authored_dataset(
        d["id"], actor="u_maria", definition=_journal_pc_agg_graph())
    with pytest.raises(ValueError, match="must pass a test run"):
        authored_datasets.submit_for_activation(d["id"], maker="u_maria")


# --- Maker-checker -------------------------------------------------------------


def test_activation_via_review_hook(state_db):
    d = _create()
    authored_datasets.test_run(d["id"], actor="u_maria")
    submitted = authored_datasets.submit_for_activation(d["id"], maker="u_maria")
    assert submitted["status"] == "in_review"
    item = _pending_item(d["id"])
    review.decide(item["id"], checker="u_sam", decision="approve")
    active = authored_datasets.get_authored_dataset(d["id"])
    assert active["status"] == "active"
    assert active["activated_by"] == "u_sam"
    events = audit.list_events(record_ref="dataset:DS-1")
    assert any(e["event_type"] == "posted" for e in events)
    assert audit.verify_chain()["ok"]


def test_maker_cannot_check_own_dataset(state_db):
    d = _create(actor="u_maria")
    authored_datasets.test_run(d["id"], actor="u_maria")
    authored_datasets.submit_for_activation(d["id"], maker="u_maria")
    item = _pending_item(d["id"])
    with pytest.raises(ValueError, match="segregation of duties"):
        review.decide(item["id"], checker="u_maria", decision="approve")
    # Still in_review, not activated.
    assert authored_datasets.get_authored_dataset(d["id"])["status"] == "in_review"


def test_reject_returns_to_draft(state_db):
    d = _create()
    authored_datasets.test_run(d["id"], actor="u_maria")
    authored_datasets.submit_for_activation(d["id"], maker="u_maria")
    item = _pending_item(d["id"])
    review.decide(item["id"], checker="u_sam", decision="reject",
                  comments="rework the grouping")
    assert authored_datasets.get_authored_dataset(d["id"])["status"] == "draft"


# --- Dataset-as-source (the bridge) -------------------------------------------


def test_active_dataset_resolves_as_source(state_db):
    base = _activated(name="GL by cost center")
    assert base["status"] == "active"
    # Another dataset SOURCES the active one and previews via the HTTP route.
    resp = client.post(
        "/api/datasets/preview",
        json={"graph": _dataset_source_graph(base["id"])})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body["columns"]) == {"RCNTR", "HSL"}
    assert body["row_count"] >= 1
    # The inlined subquery keeps money Decimal-exact: the referencing dataset's
    # total HSL equals the base dataset's total HSL (full runs, not the capped
    # preview sample).
    base_total = sum(
        (Decimal(str(r["HSL"])) for r in
         dataset.run_dataset(base["graph"], sample_limit=10_000)["rows"]),
        Decimal("0"))
    ref_total = sum(
        (Decimal(str(r["HSL"])) for r in
         dataset.run_dataset(_dataset_source_graph(base["id"]),
                             sample_limit=10_000)["rows"]),
        Decimal("0"))
    assert ref_total == base_total


def test_draft_dataset_rejected_as_source(state_db):
    draft = _create(name="Draft only")
    assert draft["status"] == "draft"
    report = dataset.validate_dataset(_dataset_source_graph(draft["id"]))
    assert report["ok"] is False
    assert any("only an ACTIVE" in e["message"] for e in report["errors"])
    # And the preview route returns a precise 400 (no SQL emitted).
    resp = client.post(
        "/api/datasets/preview",
        json={"graph": _dataset_source_graph(draft["id"])})
    assert resp.status_code == 400


def test_unknown_dataset_source_rejected(state_db):
    report = dataset.validate_dataset(_dataset_source_graph("DS-999"))
    assert report["ok"] is False
    assert any("unknown dataset source" in e["message"] for e in report["errors"])


def test_dataset_self_reference_cycle_guarded(state_db):
    # A dataset that references ITSELF as a source. Activate a base, then build a
    # graph that sources it AND would reference the same id again downstream — the
    # direct self-reference is caught when the active dataset's own graph names
    # itself. Simulate by referencing an active dataset whose graph sources it.
    base = _activated(name="cycle base")
    # Make the active dataset's stored graph reference itself (cycle): patch the
    # row directly to a self-referencing graph (bypassing edit's re-validation,
    # which would also reject it — the compiler is the backstop).
    cyclic = _dataset_source_graph(base["id"])
    import json as _json
    from state.engine import get_conn
    get_conn().execute(
        "UPDATE authored_datasets SET graph_json = ? WHERE id = ?",
        (_json.dumps(cyclic), base["id"]))
    get_conn().commit()
    report = dataset.validate_dataset(_dataset_source_graph(base["id"]))
    assert report["ok"] is False
    assert any("cycle" in e["message"] for e in report["errors"])


# --- Catalog -------------------------------------------------------------------


def test_active_dataset_listed_in_sources_catalog(state_db):
    base = _activated(name="catalog source")
    cat = client.get("/api/dataset/sources").json()
    ds_tables = [d["table"] for d in cat["datasets"]]
    assert f"dataset/{base['id']}" in ds_tables
    one = next(d for d in cat["datasets"] if d["table"] == f"dataset/{base['id']}")
    assert one["provenance"] == "authored"
    assert set(c["name"] for c in one["columns"]) == {"RCNTR", "HSL"}
    # The dataset node family is published for the palette.
    assert {n["type"] for n in cat["node_types"]} >= {
        "source", "filter", "aggregate", "join", "union", "derive", "select"}


def test_node_types_catalog_carries_dataset_family(state_db):
    base = _activated(name="node-types source")
    nt = client.get("/api/calc-graph/node-types").json()
    assert {n["type"] for n in nt["dataset_node_types"]} >= {
        "source", "filter", "aggregate", "join", "union", "derive", "select"}
    assert any(s["table"] == f"dataset/{base['id']}"
               for s in nt["dataset_sources"])


# --- Delete --------------------------------------------------------------------


def test_active_dataset_cannot_be_deleted(state_db):
    base = _activated()
    with pytest.raises(ValueError, match="only.*draft/tested"):
        authored_datasets.delete_authored_dataset(base["id"], actor="u_maria")


def test_draft_dataset_deletable_and_audited(state_db):
    d = _create()
    authored_datasets.delete_authored_dataset(d["id"], actor="u_maria")
    assert authored_datasets.get_authored_dataset(d["id"]) is None
    events = audit.list_events(record_ref="dataset:DS-1")
    assert any(e["event_type"] == "reversed" for e in events)


# --- Preview persists nothing --------------------------------------------------


def test_validate_and_preview_persist_nothing(state_db):
    before = len(authored_datasets.list_authored_datasets())
    r1 = client.post("/api/datasets/validate", json={"graph": _journal_agg_graph()})
    assert r1.status_code == 200 and r1.json()["ok"] is True
    r2 = client.post("/api/datasets/preview", json={"graph": _journal_agg_graph()})
    assert r2.status_code == 200
    assert len(authored_datasets.list_authored_datasets()) == before
