"""Master-data SQLite overlay + staging tables and CRUD."""
from __future__ import annotations

from state.engine import get_conn


def _tables() -> set[str]:
    rows = get_conn().execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    return {r["name"] for r in rows}


def test_md_tables_created(state_db):
    t = _tables()
    assert {"md_entity_function", "md_overlay", "md_staging", "md_mapping"} <= t


from state import master_data as md


def test_seed_if_empty_loads_entity_functions(state_db):
    md.seed_if_empty()
    rows = md.list_entity_functions("1000")
    codes = {r["tp_function_code"] for r in rows}
    assert codes == {"PRIN", "IPOWN"}


def test_seed_if_empty_is_idempotent(state_db):
    md.seed_if_empty()
    md.seed_if_empty()
    rows = md.list_entity_functions("3000")
    assert len(rows) == 2  # not duplicated


def test_set_overlay_records_audit_event(state_db):
    md.seed_if_empty()
    md.set_overlay("CTX-DIST-FR", {"policy_ref": "POL-DIS-26b"}, actor="u_maria")
    ov = md.get_overlay("CTX-DIST-FR")
    assert ov["policy_ref"] == "POL-DIS-26b"
    from state import audit
    events = audit.list_events(record_ref="mdctx:CTX-DIST-FR")
    assert any(e["event_type"] == "edited" for e in events)


def test_staging_seeded_with_inbound_batch(state_db):
    md.seed_if_empty()
    items = md.list_staging()
    ids = {i["id"] for i in items}
    assert {"SAP-3500", "SAP-417000", "SAP-CRD"} <= ids
    assert all(i["status"] == "unmapped" for i in items)


from fastapi.testclient import TestClient
from main import app

api = TestClient(app)


def test_overlay_put_endpoint_edits_and_audits(state_db):
    md.seed_if_empty()
    r = api.put("/api/master-data/overlay/CTX-DIST-FR", json={"policy_ref": "POL-DIS-26c", "actor": "u_maria"})
    assert r.status_code == 200
    assert r.json()["policy_ref"] == "POL-DIS-26c"
    events = api.get("/api/audit", params={"record_ref": "mdctx:CTX-DIST-FR"}).json()
    assert any(e["event_type"] == "edited" and e["actor"] == "u_maria" for e in events)


def test_entity_function_post_adds_row(state_db):
    md.seed_if_empty()
    r = api.post("/api/master-data/entity-function", json={
        "rbukrs": "3200", "tp_function_code": "SVC", "tested_party": True,
        "applies_to": ["Services"], "actor": "u_maria"})
    assert r.status_code == 200
    rows = api.get("/api/master-data/entities").json()
    fr = [x for x in rows if x["rbukrs"] == "3200"]
    assert {x["tp_function_code"] for x in fr} == {"LRD", "SVC"}
