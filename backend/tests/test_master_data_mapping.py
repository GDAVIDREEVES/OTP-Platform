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


def _pending_review_id(record_ref: str) -> int | None:
    """The latest pending review item id for a record_ref (via the UNIVERSAL queue)."""
    q = api.get("/api/review-queue", params={"status": "pending"}).json()
    matches = [r for r in q if r["record_ref"] == record_ref]
    return matches[-1]["id"] if matches else None


def test_universal_review_approve_applies_mdmap_mapping(state_db):
    # GP2 — approving an mdmap:* item from the UNIVERSAL /review queue must apply
    # the mapping (not just flip the review row): decide() owns the side-effect.
    md.seed_if_empty()
    api.post("/api/master-data/staging/SAP-3500/propose")
    api.post("/api/master-data/staging/SAP-3500/submit", json={"maker": "u_maria"})
    rid = _pending_review_id("mdmap:SAP-3500")
    assert rid is not None

    r = api.post(f"/api/review/{rid}/approve", json={"checker": "u_sam"})
    assert r.status_code == 200

    # staging row is now applied (not orphaned in in_review)
    assert md.get_staging("SAP-3500")["status"] == "applied"
    # the entity mapping is actually inserted
    rows = api.get("/api/master-data/entities").json()
    assert any(x["rbukrs"] == "3500" and x["tp_function_code"] == "LRD" for x in rows)
    # the apply event is on the mdmap record and the chain verifies
    ev = api.get("/api/audit", params={"record_ref": "mdmap:SAP-3500"}).json()
    assert any(e["event_type"] == "posted" for e in ev)
    assert api.get("/api/audit/verify").json()["ok"] is True


def test_universal_review_reject_marks_mdmap_rejected(state_db):
    # GP2 — rejecting via the universal queue marks the staging row rejected, and
    # a rejection without a comment is refused (409, the SoD/comment rule).
    md.seed_if_empty()
    api.post("/api/master-data/staging/SAP-417000/propose")
    api.post("/api/master-data/staging/SAP-417000/submit", json={"maker": "u_maria"})
    rid = _pending_review_id("mdmap:SAP-417000")
    assert rid is not None

    bad = api.post(f"/api/review/{rid}/reject", json={"checker": "u_sam"})
    assert bad.status_code == 409
    assert md.get_staging("SAP-417000")["status"] == "in_review"  # untouched

    ok = api.post(f"/api/review/{rid}/reject", json={"checker": "u_sam", "comments": "wrong function"})
    assert ok.status_code == 200
    assert md.get_staging("SAP-417000")["status"] == "rejected"
    assert api.get("/api/audit/verify").json()["ok"] is True


def test_legacy_approve_applies_exactly_once(state_db):
    # GP2 — the in-page (legacy) route still applies, and applies EXACTLY once:
    # decide() owns the side-effect, so the router no longer double-applies.
    md.seed_if_empty()
    api.post("/api/master-data/staging/SAP-3500/propose")
    api.post("/api/master-data/staging/SAP-3500/submit", json={"maker": "u_maria"})
    r = api.post("/api/master-data/staging/SAP-3500/approve", json={"checker": "u_sam"})
    assert r.status_code == 200
    assert md.get_staging("SAP-3500")["status"] == "applied"

    # exactly ONE posted/apply event on the record
    ev = api.get("/api/audit", params={"record_ref": "mdmap:SAP-3500"}).json()
    assert len([e for e in ev if e["event_type"] == "posted"]) == 1

    # exactly one entity mapping row (a double-apply would insert two)
    from state.engine import get_conn
    n = get_conn().execute("SELECT count(*) AS n FROM md_mapping WHERE kind='entity'").fetchone()["n"]
    assert n == 1
    assert api.get("/api/audit/verify").json()["ok"] is True


def test_universal_review_maker_self_approve_blocked(state_db):
    # GP2 — SoD still holds on the universal route: a maker can't approve own work.
    md.seed_if_empty()
    api.post("/api/master-data/staging/SAP-3500/propose")
    api.post("/api/master-data/staging/SAP-3500/submit", json={"maker": "u_maria"})
    rid = _pending_review_id("mdmap:SAP-3500")
    r = api.post(f"/api/review/{rid}/approve", json={"checker": "u_maria"})
    assert r.status_code == 409
    assert md.get_staging("SAP-3500")["status"] == "in_review"  # not applied


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
