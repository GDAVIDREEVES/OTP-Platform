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


def test_unplanned_flow_maps_to_covered_transaction(state_db):
    md.seed_if_empty()
    assert any(r["staging_id"] == "UNPL-3300-3400" for r in md.matrix() if r["status"] == "unmapped")
    p = api.post("/api/master-data/staging/UNPL-3300-3400/propose").json()
    assert p["proposed"]["txn_type_id"] == "SVC"
    api.post("/api/master-data/staging/UNPL-3300-3400/submit", json={"maker": "u_maria"})
    api.post("/api/master-data/staging/UNPL-3300-3400/approve", json={"checker": "u_sam"})
    rows = md.matrix()
    assert not any(r["staging_id"] == "UNPL-3300-3400" for r in rows if r["status"] == "unmapped")
    mapped = [r for r in rows if r["ctx_id"] == "CTX-UNPL-3300-3400"]
    assert mapped and mapped[0]["txn_type_id"] == "SVC" and mapped[0]["method"] == "TNMM"
    assert api.get("/api/audit/verify").json()["ok"] is True


def test_promote_stages_a_detected_flow(state_db):
    md.seed_if_empty()
    r = api.post("/api/master-data/staging/promote", json={
        "flow_id": "UNPL-1000-4100", "payer_rbukrs": "1000",
        "counterparty_rbukrs": "4100", "label": "Unplanned IC flow", "amount": 500000.0})
    assert r.status_code == 200 and r.json()["id"] == "UNPL-1000-4100"
    items = api.get("/api/master-data/staging").json()
    it = [i for i in items if i["id"] == "UNPL-1000-4100"][0]
    assert it["kind"] == "unplanned_transaction" and it["status"] == "unmapped"
