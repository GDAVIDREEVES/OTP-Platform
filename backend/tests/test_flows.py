"""Intercompany flow aggregation for the dashboard map."""
from __future__ import annotations

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)
ENTITIES = {"1000", "3000", "3100", "3200", "3300", "3400", "3800", "4100"}


def test_intercompany_flows_shape():
    r = client.get("/api/flows/intercompany")
    assert r.status_code == 200
    flows = r.json()
    assert isinstance(flows, list)
    for f in flows:
        assert f["from_rbukrs"] in ENTITIES and f["to_rbukrs"] in ENTITIES
        assert f["from_rbukrs"] != f["to_rbukrs"]
        assert f["amount"] >= 0
    pairs = {frozenset((f["from_rbukrs"], f["to_rbukrs"])) for f in flows}
    assert len(pairs) == len(flows)
