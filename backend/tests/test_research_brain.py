"""Tests for the Research Brain prepare endpoint (the visible, audited hand-off).

Phase 2 ships a scripted prepare; Phase 3 wires real Claude + researchbrain.

Run from `backend/`:  python -m pytest tests/test_research_brain.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_prepare_logs_assisted_event(state_db):
    r = client.post(
        "/api/research-brain/prepare",
        json={"process_id": "OTP-16", "record_ref": "OTP16-3000", "gap_pp": -5.2, "postings": 3147},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["summary"]
    assert body["actor"] == "research-brain"

    events = client.get("/api/audit", params={"process_id": "OTP-16"}).json()
    prepared = [e for e in events if e["event_type"] == "prepared"]
    assert prepared, "expected a prepared event"
    assert prepared[0]["actor_kind"] == "assistant"
    assert prepared[0]["actor"] == "research-brain"


def test_ask_returns_shaped_answer_with_fallback():
    # researchbrain isn't running in the test env -> graceful fallback path.
    r = client.post("/api/research-brain/ask", json={"question": "How is a royalty rate benchmarked?", "process_id": "OTP-3"})
    assert r.status_code == 200
    body = r.json()
    assert body["answer"]
    assert isinstance(body["citations"], list) and body["citations"]
    assert isinstance(body["live"], bool)


def test_prepare_computes_draftpatch_from_entity(state_db):
    # Agentic prepare pulls the real posting count + gap-to-median from the warehouse.
    r = client.post(
        "/api/research-brain/prepare",
        json={"process_id": "OTP-16", "record_ref": "OTP16-1000", "entity_id": "1000"},
    )
    assert r.status_code == 200
    dp = r.json()["draftPatch"]
    assert dp is not None
    assert dp["postings"] > 0
    assert "amount" in dp and "gapPp" in dp
    events = client.get("/api/audit", params={"process_id": "OTP-16"}).json()
    assert any(e["event_type"] == "prepared" and e["actor_kind"] == "assistant" for e in events)


# ---- answer-path selection (researchbrain → claude → offline) ----

from routers import research_brain as rb  # noqa: E402


def test_status_reports_mode_and_components(monkeypatch):
    monkeypatch.setattr(rb, "_probe_researchbrain", lambda: (False, "unreachable (ConnectError)"))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    body = client.get("/api/research-brain/status").json()
    assert body["mode"] == "offline"
    assert body["researchbrain"]["reachable"] is False
    assert body["claude"]["configured"] is False


def test_auth_header_sent_when_key_configured(monkeypatch):
    monkeypatch.setattr(rb, "RESEARCH_BRAIN_API_KEY", "secret-token")
    assert rb._auth_headers() == {"Authorization": "Bearer secret-token"}
    monkeypatch.setattr(rb, "RESEARCH_BRAIN_API_KEY", "")
    assert rb._auth_headers() == {}


def test_ask_uses_researchbrain_when_retrieval_succeeds(monkeypatch):
    results = [{"source": "OECD TPG 2022", "concept_path": "TP/Benchmarking", "content": "Interquartile range …", "authority_tier": 1, "rerankScore": 0.91}]
    monkeypatch.setattr(rb, "_retrieve", lambda payload: (rb._citations(results), results, True, "ok"))
    monkeypatch.setattr(rb, "_claude", lambda prompt, system, max_tokens=1500: "Grounded answer.")
    body = client.post("/api/research-brain/ask", json={"question": "IQR?"}).json()
    assert body["mode"] == "researchbrain" and body["live"] is True
    assert body["answer"] == "Grounded answer."
    assert body["citations"][0]["source"] == "OECD TPG 2022" and body["citations"][0]["tier"] == "primary"


def test_ask_falls_back_to_claude_direct_without_researchbrain(monkeypatch):
    monkeypatch.setattr(rb, "_retrieve", lambda payload: ([], [], False, "researchbrain unreachable at http://127.0.0.1:3000 (ConnectError)"))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setattr(rb, "_claude", lambda prompt, system, max_tokens=1500: "Direct answer.")
    body = client.post("/api/research-brain/ask", json={"question": "Safe harbour?", "jurisdiction": "Ireland"}).json()
    assert body["mode"] == "claude" and body["live"] is True
    assert body["answer"] == "Direct answer." and body["citations"] == []
    assert "unreachable" in body["note"]


def test_ask_offline_when_nothing_configured(monkeypatch):
    monkeypatch.setattr(rb, "_retrieve", lambda payload: ([], [], False, "researchbrain unreachable"))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    body = client.post("/api/research-brain/ask", json={"question": "x"}).json()
    assert body["mode"] == "offline" and body["live"] is False and body["citations"]
