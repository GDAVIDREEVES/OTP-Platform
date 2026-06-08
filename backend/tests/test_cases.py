"""TDD for the governance Case Workspace state module (state/cases.py).

Run from `backend/`:  python -m pytest tests/test_cases.py
"""

from __future__ import annotations

import pytest

import state.audit as audit
import state.cases as cases


def test_seed_populates_with_parsed_checklists(state_db):
    cases.seed_if_empty()
    seeded = cases.list_cases()
    assert len(seeded) >= 4
    for c in seeded:
        assert isinstance(c["checklist"], list)
        assert "checklist_json" not in c
        for step in c["checklist"]:
            assert {"key", "label", "done"} <= set(step)


def test_list_cases_filters_by_process_and_status(state_db):
    cases.seed_if_empty()
    otp40 = cases.list_cases(process_id="OTP-40")
    assert otp40
    assert all(c["process_id"] == "OTP-40" for c in otp40)

    closed = cases.list_cases(status="closed")
    assert closed
    assert all(c["status"] == "closed" for c in closed)


def test_create_case_returns_open_and_logs_created(state_db):
    case = cases.create_case(
        process_id="OTP-40", kind="audit_defense",
        title="New field audit", owner="Sam Rodriguez", actor="u_demo",
    )
    assert case["status"] == "open"
    assert case["checklist"] == []
    events = audit.list_events(record_ref=f"case:{case['id']}")
    created = [e for e in events if e["event_type"] == "created"]
    assert len(created) == 1
    assert created[0]["actor"] == "u_demo"


def test_set_status_submitted_logs_submitted(state_db):
    case = cases.create_case(
        process_id="OTP-50", kind="map", title="MAP filing",
        owner="Daniel Okafor", actor="u_demo",
    )
    updated = cases.set_status(case["id"], "submitted", "u_demo")
    assert updated["status"] == "submitted"
    events = audit.list_events(record_ref=f"case:{case['id']}")
    assert any(e["event_type"] == "submitted" for e in events)


def test_set_status_closed_logs_posted(state_db):
    case = cases.create_case(
        process_id="OTP-50", kind="map", title="MAP filing to close",
        owner="Daniel Okafor", actor="u_demo",
    )
    updated = cases.set_status(case["id"], "closed", "u_demo")
    assert updated["status"] == "closed"
    events = audit.list_events(record_ref=f"case:{case['id']}")
    assert any(e["event_type"] == "posted" for e in events)


def test_set_status_invalid_raises(state_db):
    case = cases.create_case(
        process_id="OTP-30", kind="restructuring", title="Restructuring",
        owner="Priya Natarajan", actor="u_demo",
    )
    with pytest.raises(ValueError):
        cases.set_status(case["id"], "archived", "u_demo")


def test_set_status_unknown_case_raises(state_db):
    with pytest.raises(ValueError):
        cases.set_status("CASE-9999", "submitted", "u_demo")


def test_set_checklist_step_toggles_persists_and_logs_edited(state_db):
    case = cases.create_case(
        process_id="OTP-40", kind="audit_defense", title="Audit with steps",
        owner="Sam Rodriguez",
        checklist=[{"key": "econ", "label": "Economic analysis", "done": False}],
        actor="u_demo",
    )
    updated = cases.set_checklist_step(case["id"], "econ", True, "u_demo")
    step = next(s for s in updated["checklist"] if s["key"] == "econ")
    assert step["done"] is True

    # Persisted: a fresh read reflects the toggle.
    reread = cases.get_case(case["id"])
    assert next(s for s in reread["checklist"] if s["key"] == "econ")["done"] is True

    events = audit.list_events(record_ref=f"case:{case['id']}")
    assert any(e["event_type"] == "edited" for e in events)


def test_set_checklist_step_unknown_step_raises(state_db):
    case = cases.create_case(
        process_id="OTP-40", kind="audit_defense", title="Audit no such step",
        owner="Sam Rodriguez",
        checklist=[{"key": "econ", "label": "Economic analysis", "done": False}],
        actor="u_demo",
    )
    with pytest.raises(ValueError):
        cases.set_checklist_step(case["id"], "nope", True, "u_demo")


def test_set_checklist_step_unknown_case_raises(state_db):
    with pytest.raises(ValueError):
        cases.set_checklist_step("CASE-9999", "econ", True, "u_demo")
