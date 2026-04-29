"""Smoke tests for the OTP Platform backend.

Run from `backend/`:  python -m pytest tests
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health_returns_ok():
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert "data_dir" in body
    assert isinstance(body["entity_roles_rows"], int)
