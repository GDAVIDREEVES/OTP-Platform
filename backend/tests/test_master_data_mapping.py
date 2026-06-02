"""End-to-end inbound mapping: staging -> propose -> submit -> approve -> applied."""
from __future__ import annotations

from fastapi.testclient import TestClient

from main import app
from state import master_data as md

api = TestClient(app)


def test_full_mapping_flow_applies_entity_and_audits(state_db):
    md.seed_if_empty()
    q = api.get("/api/master-data/staging").json()
    assert any(i["id"] == "SAP-3500" and i["status"] == "unmapped" for i in q)

    p = api.post("/api/master-data/staging/SAP-3500/propose").json()
    assert p["proposed"]["tp_function_code"] == "LRD"
    assert p["confidence"]

    s = api.post("/api/master-data/staging/SAP-3500/submit", json={"maker": "u_maria"})
    assert s.status_code == 200

    a = api.post("/api/master-data/staging/SAP-3500/approve", json={"checker": "u_sam"})
    assert a.status_code == 200

    rows = api.get("/api/master-data/entities").json()
    assert any(r["rbukrs"] == "3500" and r["tp_function_code"] == "LRD" for r in rows)

    assert api.get("/api/audit/verify").json()["ok"] is True
    ev = api.get("/api/audit", params={"record_ref": "mdmap:SAP-3500"}).json()
    kinds = {e["actor_kind"] for e in ev}
    assert "assistant" in kinds and "human" in kinds


def test_maker_cannot_approve_own_mapping(state_db):
    md.seed_if_empty()
    api.post("/api/master-data/staging/SAP-417000/propose")
    api.post("/api/master-data/staging/SAP-417000/submit", json={"maker": "u_maria"})
    r = api.post("/api/master-data/staging/SAP-417000/approve", json={"checker": "u_maria"})
    assert r.status_code == 400


def test_simulate_adds_a_new_unmapped_item(state_db):
    md.seed_if_empty()
    before = len(api.get("/api/master-data/staging").json())
    api.post("/api/master-data/staging/simulate")
    after = len(api.get("/api/master-data/staging").json())
    assert after == before + 1
