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
