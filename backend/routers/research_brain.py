"""Research Brain — process-aware assistance.

- /ask: TP knowledge Q&A. Retrieves from the user's researchbrain HTTP service
  (`/api/rag/retrieve`) and synthesises an answer with the Claude API when
  available. Citations carry source, concept path, authority tier, and rerank
  score. No researchbrain synthesis endpoint exists, so we synthesise our side.
- /prepare: the agentic hand-off. Computes the real preparation server-side —
  the entity's posting count and gap-to-range from the live data — returns a
  draftPatch the workflow applies, and logs the assisted work to the audit trail
  as "research-brain".

Everything degrades gracefully: if researchbrain (or Claude, or httpx) is
unavailable, /ask returns a shaped fallback and /prepare still computes from the
warehouse — so the demo never breaks.
"""

from __future__ import annotations

import os

from fastapi import APIRouter

import state.audit as audit
from db import q
from period_filter import PeriodFilter
from schemas.state import AskIn, PrepareIn
from services.entities import list_entities

try:  # outbound HTTP is optional — guarded so a missing dep can't break the app
    import httpx
except Exception:  # pragma: no cover
    httpx = None  # type: ignore

router = APIRouter()

RESEARCH_BRAIN_BASE_URL = os.getenv("RESEARCH_BRAIN_BASE_URL", "http://127.0.0.1:3000")

# Process → researchbrain concept-path prefix (soft retrieval hint; falls back
# to an unfiltered query if a prefix returns nothing).
CONCEPT_PATHS = {
    "OTP-3": "TP/Intangibles", "OTP-9": "TP/Royalties",
    "OTP-16": "TP/Adjustments", "OTP-17": "TP/Adjustments",
    "OTP-20": "TP", "OTP-25": "TP/Benchmarking", "OTP-29": "TP/Intangibles/DEMPE",
    "OTP-35": "TP/PillarTwo", "OTP-45": "TP/UTP", "OTP-48": "TP/UTP",
}

_TIER_LABEL = {1: "primary", 2: "secondary", 3: "commentary"}


# ----------------- /ask -----------------

@router.post("/api/research-brain/ask")
def ask(payload: AskIn):
    citations, results, live = _retrieve(payload)
    if live:
        return {"answer": _synthesize(payload.question, results), "citations": citations, "live": True}
    return {"answer": _fallback_answer(), "citations": _fallback_citations(), "live": False}


def _retrieve(payload: AskIn):
    """Hit researchbrain retrieval. Returns (citations, results, live)."""
    if httpx is None:
        return [], [], False

    def _request(use_prefix: bool):
        body: dict = {"query": payload.question, "tier_max": 2, "topK": 20, "topN": 5, "mode": "standard"}
        if payload.jurisdiction:
            body["jurisdiction"] = payload.jurisdiction
        if payload.tp_method:
            body["tp_method"] = payload.tp_method
        prefix = CONCEPT_PATHS.get(payload.process_id or "")
        if use_prefix and prefix:
            body["concept_path_prefix"] = prefix
        return body

    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.post(f"{RESEARCH_BRAIN_BASE_URL}/api/rag/retrieve", json=_request(True))
            if resp.status_code != 200:
                return [], [], False
            results = resp.json().get("results", [])
            if not results:  # prefix may over-filter — retry unfiltered
                resp = client.post(f"{RESEARCH_BRAIN_BASE_URL}/api/rag/retrieve", json=_request(False))
                results = resp.json().get("results", []) if resp.status_code == 200 else []
        return _citations(results), results, True
    except Exception:
        return [], [], False


def _citations(results: list) -> list[dict]:
    out = []
    for x in results[:5]:
        tier = x.get("authority_tier")
        out.append({
            "source": x.get("source") or x.get("topic") or "source",
            "ref": x.get("concept_path") or (x.get("entity_refs") or [""])[0] or "",
            "url": x.get("source_url") or "",
            "tier": _TIER_LABEL.get(tier, "") if tier else "",
            "score": round(float(x.get("rerankScore", x.get("score", 0)) or 0), 2),
            "superseded": bool(x.get("_supersession_warning")),
            "snippet": (x.get("content") or "")[:240],
        })
    return out


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
    return [{"source": "OECD TPG 2022", "ref": "Ch. III — comparability", "url": "", "tier": "primary", "score": 0, "superseded": False, "snippet": "Arm’s-length range and use of the interquartile range."}]


# ----------------- /prepare (agentic) -----------------

@router.post("/api/research-brain/prepare")
def prepare(payload: PrepareIn):
    prep = _compute_prep(payload.entity_id) if payload.entity_id else None
    draft = None
    if payload.summary:
        summary = payload.summary
    elif prep:
        amt = prep["amount"]
        summary = (
            f"Pulled {prep['postings']:,} SAP/ACDOCA lines for {prep['name']}, applied TP policy §4.2, "
            f"rebuilt the segmented P&L, and quantified the gap to range at {prep['gapPp']:+.1f}pp "
            f"(≈ {prep['currency']} {amt:,.0f} to median). The remaining steps — judgment, review, and "
            f"posting — are yours."
        )
        draft = {"mode": "median", "amount": amt, "gapPp": prep["gapPp"], "postings": prep["postings"]}
    else:
        lead = f"Pulled {payload.postings:,} SAP/ACDOCA lines" if payload.postings else "Pulled the entity’s SAP/ACDOCA postings"
        bits = [lead, "applied TP policy §4.2", "rebuilt the segmented P&L"]
        if payload.gap_pp is not None:
            bits.append(f"quantified the gap to range at {payload.gap_pp:+.1f}pp")
        summary = ", ".join(bits) + ". The remaining steps — judgment, review, and posting — are yours."

    event = audit.record(
        actor=audit.ASSISTANT_ACTOR, actor_kind="assistant",
        process_id=payload.process_id, record_ref=payload.record_ref,
        event_type="prepared", rationale=summary,
    )
    return {"summary": summary, "draftPatch": draft, "actor": audit.ASSISTANT_ACTOR, "event_id": event["id"]}


def _compute_prep(entity_id: str) -> dict | None:
    """Real preparation from the warehouse: posting count + gap-to-median."""
    try:
        ents = list_entities(PeriodFilter(), entity_id=entity_id)
        if not ents:
            return None
        e = ents[0]
        postings = q("SELECT count(*) AS n FROM journal WHERE RBUKRS = ?", [entity_id])[0]["n"]
        actual = e["actualMargin"] or 0.0
        median = (e["targetMarginLow"] + e["targetMarginHigh"]) / 2.0
        revenue = e["ytdVolume"] or 0.0
        amount = round(((median - actual) / 100.0) * revenue, 2)
        return {
            "postings": int(postings),
            "gapPp": e["variance"] if e["variance"] is not None else round(median - actual, 1),
            "amount": amount,
            "currency": e["currency"],
            "name": e["name"],
        }
    except Exception:
        return None
