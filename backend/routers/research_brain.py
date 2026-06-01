"""Research Brain — process-aware assistance.

Two endpoints:
- /prepare: the agentic "prepare steps" hand-off. Logs the assisted work to the
  audit trail as a distinct actor ("research-brain").
- /ask: TP knowledge Q&A. Connects to the user's researchbrain HTTP service for
  real, citation-backed retrieval, optionally synthesised with the Claude API.

Both degrade gracefully: if researchbrain (or Claude, or httpx) isn't available,
a shaped fallback is returned so the demo never breaks. The response shape and
the audit boundary are identical either way.
"""

from __future__ import annotations

import os

from fastapi import APIRouter

import state.audit as audit
from schemas.state import AskIn, PrepareIn

try:  # outbound HTTP is optional — guarded so a missing dep can't break the app
    import httpx
except Exception:  # pragma: no cover
    httpx = None  # type: ignore

router = APIRouter()

RESEARCH_BRAIN_BASE_URL = os.getenv("RESEARCH_BRAIN_BASE_URL", "http://127.0.0.1:3000")


@router.post("/api/research-brain/prepare")
def prepare(payload: PrepareIn):
    if payload.summary:
        summary = payload.summary
    else:
        lead = f"Pulled {payload.postings:,} SAP/ACDOCA lines" if payload.postings else "Pulled the entity’s SAP/ACDOCA postings"
        parts = [lead, "applied TP policy §4.2", "rebuilt the segmented P&L"]
        if payload.gap_pp is not None:
            parts.append(f"quantified the gap to range at {payload.gap_pp:+.1f}pp")
        summary = ", ".join(parts) + ". The remaining steps — judgment, review, and posting — are yours."

    event = audit.record(
        actor=audit.ASSISTANT_ACTOR,
        actor_kind="assistant",
        process_id=payload.process_id,
        record_ref=payload.record_ref,
        event_type="prepared",
        rationale=summary,
    )
    return {"summary": summary, "actor": audit.ASSISTANT_ACTOR, "event_id": event["id"]}


@router.post("/api/research-brain/ask")
def ask(payload: AskIn):
    citations, results, live = _retrieve(payload)
    if live:
        return {"answer": _synthesize(payload.question, results), "citations": citations, "live": True}
    return {"answer": _fallback_answer(), "citations": _fallback_citations(), "live": False}


# ----------------- internals -----------------

def _retrieve(payload: AskIn):
    """Hit the researchbrain retrieval service. Returns (citations, results, live)."""
    if httpx is None:
        return [], [], False
    body: dict = {"query": payload.question, "topic": "transfer-pricing", "topK": 20, "topN": 5}
    if payload.jurisdiction:
        body["jurisdiction"] = payload.jurisdiction
    if payload.tp_method:
        body["tp_method"] = payload.tp_method
    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.post(f"{RESEARCH_BRAIN_BASE_URL}/api/rag/retrieve", json=body)
        if resp.status_code != 200:
            return [], [], False
        results = resp.json().get("results", [])
        citations = [
            {
                "source": x.get("source") or x.get("topic") or "source",
                "ref": x.get("concept_path") or (x.get("entity_refs") or [""])[0] or "",
                "snippet": (x.get("content") or "")[:240],
            }
            for x in results[:5]
        ]
        return citations, results, True
    except Exception:
        return [], [], False


def _synthesize(question: str, results: list) -> str:
    snippets = [x.get("content", "") for x in results[:3] if x.get("content")]
    grounding = "\n\n".join(snippets)[:4000]
    key = os.getenv("ANTHROPIC_API_KEY")
    if key and grounding:
        try:
            import anthropic

            client = anthropic.Anthropic(api_key=key)
            msg = client.messages.create(
                model=os.getenv("OTP_CLAUDE_MODEL", "claude-3-5-haiku-latest"),
                max_tokens=400,
                system="You are a transfer-pricing assistant. Answer concisely and only from the provided sources.",
                messages=[{"role": "user", "content": f"Question: {question}\n\nSources:\n{grounding}"}],
            )
            text = "".join(getattr(b, "text", "") for b in msg.content).strip()
            if text:
                return text
        except Exception:
            pass
    return _templated(snippets)


def _templated(snippets: list[str]) -> str:
    if not snippets:
        return "No grounded sources were found for that question in the knowledge base."
    head = snippets[0].strip()
    return "Based on the firm’s TP knowledge base: " + head[:280] + ("…" if len(head) > 280 else "")


def _fallback_answer() -> str:
    return (
        "The Research Brain knowledge service isn’t reachable right now, so this is general guidance "
        "rather than a cited answer. For arm’s-length questions, compare the tested party’s PLI against "
        "the benchmarking interquartile range; where it falls outside, a compensating adjustment to the "
        "median is the usual defensible position, documented contemporaneously. Reconnect the "
        "researchbrain service for sourced, citation-backed answers."
    )


def _fallback_citations() -> list[dict]:
    return [{"source": "OECD TPG 2022", "ref": "Ch. III — comparability", "snippet": "Arm’s-length range and use of the interquartile range."}]
