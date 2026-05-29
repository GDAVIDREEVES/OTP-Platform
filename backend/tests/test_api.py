"""API-level tests against the real parquet dataset.

Run from `backend/`:  python -m pytest tests/test_api.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_kpis_includes_no_data_count():
    body = client.get("/api/kpis").json()
    assert "entitiesNoData" in body
    assert isinstance(body["entitiesNoData"], int)


def test_kpis_status_buckets_sum_to_entity_count():
    body = client.get("/api/kpis").json()
    buckets = (
        body["entitiesInRange"]
        + body["entitiesWatch"]
        + body["entitiesOutOfRange"]
        + body["entitiesNoData"]
    )
    assert buckets == body["entityCount"]


def test_get_entity_returns_requested_entity():
    entities = client.get("/api/entities").json()
    assert entities, "expected at least one entity in the dataset"
    target = entities[0]["id"]
    resp = client.get(f"/api/entities/{target}")
    assert resp.status_code == 200
    assert resp.json()["id"] == target


def test_get_entity_unknown_returns_404():
    resp = client.get("/api/entities/__nope__")
    assert resp.status_code == 404
