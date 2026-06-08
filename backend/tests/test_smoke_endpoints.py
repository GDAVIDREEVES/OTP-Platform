"""Smoke test: every GET endpoint returns 200 against the real dataset.

Doubles as the regression net for the read_parquet -> DuckDB-view refactor.

Run from `backend/`:  python -m pytest tests/test_smoke_endpoints.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

# Endpoints backed purely by the DuckDB views (no SQLite state needed).
DUCKDB_GETS = [
    "/api/health",
    "/api/kpis",
    "/api/margins/trend",
    "/api/transactions/flows",
    "/api/transactions/royalties",
    "/api/segments/pl",
    "/api/journal-entries",
    "/api/berry",
    "/api/years",
]


def test_duckdb_get_endpoints_ok():
    for path in DUCKDB_GETS:
        r = client.get(path)
        assert r.status_code == 200, (path, r.status_code, r.text[:300])


def test_entity_endpoints_ok():
    entities = client.get("/api/entities").json()
    assert entities, "expected entities from the dataset"
    eid = entities[0]["id"]
    assert client.get(f"/api/entities/{eid}").status_code == 200
    assert client.get(f"/api/entities/{eid}/flows").status_code == 200


def test_state_backed_get_endpoints_ok(state_db):
    # /api/invoices reads supply_chain (view) AND the SQLite adjustments store.
    for path in ("/api/adjustments", "/api/settings", "/api/overrides/policy", "/api/invoices"):
        r = client.get(path)
        assert r.status_code == 200, (path, r.status_code, r.text[:300])


def test_invoices_material_type_filter_service(state_db):
    """material_type=SERVICE returns only SERVICE buckets with cost/markup/lines."""
    r = client.get("/api/invoices?material_type=SERVICE")
    assert r.status_code == 200, r.text[:300]
    svc = r.json()
    assert svc, "expected SERVICE invoices from the dataset"
    # Only SERVICE buckets, and none of the submitted-adjustment rows.
    assert all(d["materialType"] == "SERVICE" for d in svc)
    assert all(not d.get("submitted") for d in svc)
    # Backend-sourced KPI inputs are present and self-consistent.
    total = sum(d["amount"] for d in svc)
    cost = sum(d["costBase"] for d in svc)
    lines = sum(d["lines"] for d in svc)
    assert total > 0 and cost > 0 and lines >= len(svc)
    blended = (total - cost) / cost
    assert 0.04 <= blended <= 0.07, blended  # cost-plus service markup ~5.5%

    # Filtering is a strict subset of the unfiltered response (param absent).
    all_svc = [d for d in client.get("/api/invoices").json()
               if d.get("materialType") == "SERVICE"]
    assert len(svc) == len(all_svc)
