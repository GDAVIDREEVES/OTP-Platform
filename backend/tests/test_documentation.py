"""Documentation rollup — per-entity covered-transaction workpaper feed for
OTP-37 / OTP-32 / OTP-33."""
from __future__ import annotations

from fastapi.testclient import TestClient

from main import app
from state import master_data as md

client = TestClient(app)


def test_documentation_rolls_up_covered_by_tested_entity(state_db):
    md.seed_if_empty()
    body = client.get("/api/documentation").json()
    by_rb = {e["rbukrs"]: e for e in body["entities"]}

    # France LRD distributor is the tested party on CTX-DIST-FR.
    fr = by_rb["3200"]
    assert fr["country"] == "France"
    assert fr["functional_currency"]  # resolved from the master
    ctx = next(c for c in fr["covered"] if c["ctx_id"] == "CTX-DIST-FR")
    assert ctx["method"] == "TNMM"
    assert (ctx["lower"], ctx["upper"]) == (2.0, 4.0)  # reference benchmark range
    assert ctx["oecd_anchor"]  # FAR / method narrative anchor
    assert ctx["policy_ref"] == "POL-DIS-26"
    assert ctx["status"] in {"in_range", "review", "na"}
    # FAR/function comes from the entity master, never hardcoded.
    assert fr["tp_function_code"] and fr["tp_function_label"]


def test_documentation_evidence_ref_resolves_via_evidence_endpoint(state_db):
    md.seed_if_empty()
    body = client.get("/api/documentation").json()
    ch = next(e for e in body["entities"] if e["rbukrs"] == "3100")  # Switzerland IP principal
    assert ch["evidence_ref"] == "doc:3100"
    # the linked evidence ref composes the existing audit+postings+chain packet
    pkt = client.get(f"/api/evidence/{ch['evidence_ref']}").json()
    assert pkt["record_ref"] == "doc:3100"
    assert "verify" in pkt and "postings" in pkt
    # every covered row carries the same evidence ref so the drawer can open it
    assert all(c["evidence_ref"] == "doc:3100" for c in ch["covered"])


def test_documentation_excludes_unmapped_and_totals_reconcile(state_db):
    md.seed_if_empty()
    body = client.get("/api/documentation").json()
    # no unmapped flow leaks into a documentation workpaper
    for e in body["entities"]:
        assert all(c["status"] != "unmapped" for c in e["covered"])
    # totals are the sum of the per-entity counts (single source of truth)
    t = body["totals"]
    assert t["entities"] == len(body["entities"])
    assert t["covered"] == sum(e["covered_count"] for e in body["entities"])
    assert t["in_range"] == sum(e["in_range"] for e in body["entities"])
    assert t["covered"] >= 1
