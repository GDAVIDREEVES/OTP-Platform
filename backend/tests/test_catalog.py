"""TDD for the data catalog (services/catalog.py + routers/catalog.py).

The catalog is the governed inventory of every data source: the read-only
warehouse views, the mutable SQLite state tables, the auto-discovered reference
seeds, and the governed calc parameters. These tests cover: every tier is
listed; seed provenance is derived (fabricated seeds vs assumed); the
parameter tier picks up beat.racct_type as fabricated; entry-by-id 404s on an
unknown id; and the provenance rollup buckets every source with a total.

Run from `backend/`:  python -m pytest tests/test_catalog.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

import state.parameters as parameters
from main import app
from services import catalog
from state import seeds

client = TestClient(app)


def test_seeds_meta_derives_fabricated():
    # explicit `fabricated: true`
    assert seeds.meta("captive")["provenance"] == "fabricated"
    assert seeds.meta("vat")["provenance"] == "fabricated"
    # note opens with "FABRICATED" but no flag (legacy seeds)
    assert seeds.meta("treasury")["provenance"] == "fabricated"
    assert seeds.meta("stewardship")["provenance"] == "fabricated"
    # illustrative reference over a real base → assumed
    assert seeds.meta("wht_treaty")["provenance"] == "assumed"
    assert seeds.meta("benchmarks")["provenance"] == "assumed"


def test_seeds_names_lists_all_registered():
    names = seeds.names()
    assert "treasury" in names
    assert "cbcr" in names
    assert "benchmarks" in names


def test_catalog_lists_every_tier(state_db):
    parameters.seed_if_empty()
    entries = catalog.catalog()
    kinds = {e["kind"] for e in entries}
    assert kinds == {"warehouse", "state", "seed", "parameter"}

    ids = {e["id"] for e in entries}
    assert "warehouse:segment_pl" in ids
    assert "warehouse:journal" in ids
    assert "state:cases" in ids
    assert "state:parameters" in ids
    assert "seed:treasury" in ids
    assert "parameter:beat.racct_type" in ids

    # every entry carries the curated shape
    for e in entries:
        assert set(e) >= {"id", "kind", "name", "description", "provenance", "lineage"}


def test_catalog_lists_all_seeds(state_db):
    parameters.seed_if_empty()
    entries = catalog.catalog()
    seed_ids = {e["id"] for e in entries if e["kind"] == "seed"}
    assert seed_ids == {f"seed:{n}" for n in seeds.names()}


def test_catalog_api_returns_full_list():
    body = client.get("/api/catalog").json()
    assert isinstance(body, list)
    kinds = {e["kind"] for e in body}
    assert {"warehouse", "state", "seed", "parameter"} <= kinds


def test_catalog_entry_by_id():
    body = client.get("/api/catalog/warehouse:segment_pl").json()
    assert body["id"] == "warehouse:segment_pl"
    assert body["kind"] == "warehouse"
    assert body["provenance"] == "real"


def test_catalog_entry_unknown_404():
    res = client.get("/api/catalog/nope:does-not-exist")
    assert res.status_code == 404


def test_provenance_rollup_buckets(state_db):
    parameters.seed_if_empty()
    roll = catalog.provenance_rollup()
    buckets = roll["buckets"]
    assert set(buckets) >= {"real", "assumed", "fabricated"}

    # warehouse + state tiers are real
    assert buckets["real"]["count"] > 0
    real_ids = {i["id"] for i in buckets["real"]["items"]}
    assert "warehouse:segment_pl" in real_ids
    assert "state:audit_events" in real_ids

    # the fabricated seeds + the beat.racct_type parameter land in fabricated
    fab_ids = {i["id"] for i in buckets["fabricated"]["items"]}
    for n in ("treasury", "captive", "fx", "guarantee", "customs", "stewardship", "vat"):
        assert f"seed:{n}" in fab_ids
    assert "parameter:beat.racct_type" in fab_ids

    # total ties out to every entry
    assert roll["total"] == len(catalog.catalog())
    assert roll["total"] == sum(b["count"] for b in buckets.values())


def test_provenance_rollup_via_api():
    body = client.get("/api/catalog/provenance").json()
    assert "buckets" in body
    assert "total" in body
    assert body["total"] == sum(b["count"] for b in body["buckets"].values())
