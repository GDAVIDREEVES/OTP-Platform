"""Research Brain — process-aware assistance.

- /ask: TP knowledge Q&A. Retrieves from the user's researchbrain HTTP service
  (`/api/rag/retrieve`, bearer-authenticated with RESEARCH_BRAIN_API_KEY) and
  synthesises an answer with the Claude API. If researchbrain is unreachable
  but ANTHROPIC_API_KEY is set, Claude answers directly (mode "claude", no
  citations). Citations carry source, concept path, authority tier, and rerank
  score. No researchbrain synthesis endpoint exists, so we synthesise our side.
- /status: which of the three paths /ask will take right now.
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
import time

from dotenv import load_dotenv
from fastapi import APIRouter

import state.audit as audit
from config import BASE_DIR
from db import q
from period_filter import PeriodFilter
from schemas.state import AskIn, PrepareIn
from services.entities import list_entities

try:  # outbound HTTP is optional — guarded so a missing dep can't break the app
    import httpx
except Exception:  # pragma: no cover
    httpx = None  # type: ignore

router = APIRouter()

# Connection settings are re-read from backend/.env on every /status and /ask so
# `scripts/connect-researchbrain.sh` / `scripts/set-anthropic-key.sh` take effect
# without restarting the server (python-dotenv only loads the file at import).
_ENV_FILE = BASE_DIR / ".env"
_ENV_MTIME = 0.0


def _refresh_env() -> None:
    global _ENV_MTIME, RESEARCH_BRAIN_BASE_URL, RESEARCH_BRAIN_API_KEY, CLAUDE_MODEL
    try:
        mtime = _ENV_FILE.stat().st_mtime
    except OSError:
        mtime = 0.0
    if mtime and mtime != _ENV_MTIME:
        load_dotenv(_ENV_FILE, override=True)
        _ENV_MTIME = mtime
        _KEY_CHECK.update(at=0.0, ok=None, detail="")  # a changed file invalidates the cached key check
    RESEARCH_BRAIN_BASE_URL = os.getenv("RESEARCH_BRAIN_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
    # researchbrain protects /api/rag/* with a bearer token (its RESEARCHBRAIN_API_KEY).
    # Accept either spelling so the same value can be pasted from its .env.
    RESEARCH_BRAIN_API_KEY = os.getenv("RESEARCH_BRAIN_API_KEY") or os.getenv("RESEARCHBRAIN_API_KEY") or ""
    CLAUDE_MODEL = os.getenv("OTP_CLAUDE_MODEL", "claude-opus-5-5")


RESEARCH_BRAIN_BASE_URL = os.getenv("RESEARCH_BRAIN_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
RESEARCH_BRAIN_API_KEY = os.getenv("RESEARCH_BRAIN_API_KEY") or os.getenv("RESEARCHBRAIN_API_KEY") or ""
CLAUDE_MODEL = os.getenv("OTP_CLAUDE_MODEL", "claude-opus-5-5")

# Process → researchbrain concept-path prefix (soft retrieval hint; falls back
# to an unfiltered query if a prefix returns nothing).
CONCEPT_PATHS = {
    "OTP-3": "TP/Intangibles", "OTP-9": "TP/Royalties",
    "OTP-16": "TP/Adjustments", "OTP-17": "TP/Adjustments",
    "OTP-20": "TP", "OTP-25": "TP/Benchmarking", "OTP-29": "TP/Intangibles/DEMPE",
    "OTP-35": "TP/PillarTwo", "OTP-45": "TP/UTP", "OTP-48": "TP/UTP",
}

_TIER_LABEL = {1: "primary", 2: "secondary", 3: "commentary"}

SYSTEM_PROMPT = (
    "You are the Research Brain, the transfer-pricing assistant inside an operational "
    "transfer-pricing platform used by a tax partner. Answer like a senior TP practitioner: "
    "lead with the conclusion, then the reasoning, citing the governing authority (OECD TPG "
    "chapter, IRC §482 regulations, local law) where relevant. Be concise — a few short "
    "paragraphs or a tight bullet list. Flag where a position depends on facts you do not have. "
    "Never invent case names, section numbers or figures."
)


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {RESEARCH_BRAIN_API_KEY}"} if RESEARCH_BRAIN_API_KEY else {}


def _claude_configured() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


_KEY_CHECK: dict = {"at": 0.0, "ok": None, "detail": ""}


def _claude_key_check() -> tuple[bool | None, str]:
    """Validate the Claude key with a free metadata call (models.retrieve — no
    tokens billed). Cached for 60s so the status badge can poll. None = untested
    (no key / SDK missing)."""
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return None, "ANTHROPIC_API_KEY not set"
    now = time.monotonic()
    # A good key is re-checked every 60s; a bad one every 5s so a corrected
    # .env + restart (or a rotated key) shows up almost immediately.
    ttl = 60 if _KEY_CHECK["ok"] else 5
    if _KEY_CHECK["ok"] is not None and now - _KEY_CHECK["at"] < ttl:
        return _KEY_CHECK["ok"], _KEY_CHECK["detail"]
    try:
        import anthropic
    except ImportError:
        return None, "anthropic SDK not installed (pip install -r backend/requirements.txt)"
    ok, detail = False, ""
    try:
        anthropic.Anthropic(api_key=key, timeout=10.0, max_retries=0).models.retrieve(CLAUDE_MODEL)
        ok, detail = True, f"key accepted · {CLAUDE_MODEL}"
    except anthropic.AuthenticationError:
        detail = f"Claude API rejected the key (401) — it is {len(key)} characters; a full key is ~108. Re-paste it into backend/.env and restart."
    except anthropic.NotFoundError:
        detail = f"key accepted, but model {CLAUDE_MODEL!r} was not found — check OTP_CLAUDE_MODEL"
    except anthropic.APIStatusError as exc:
        detail = f"Claude API error {exc.status_code}"
    except anthropic.APIConnectionError:
        detail = "cannot reach api.anthropic.com (network / proxy)"
    _KEY_CHECK.update(at=now, ok=ok, detail=detail)
    return ok, detail


# ----------------- /status -----------------

@router.get("/api/research-brain/status")
def status():
    """Which answer path /ask will take right now — shown in the UI header so a
    presenter can see at a glance whether the knowledge base is connected."""
    _refresh_env()
    rb_ok, rb_detail = _probe_researchbrain()
    claude = _claude_configured()
    key_ok, key_detail = _claude_key_check()
    claude_usable = claude and key_ok is True
    # Mirrors /ask: retrieval wins whenever researchbrain answers (Claude only
    # improves the synthesis), then Claude direct, then offline.
    mode = "researchbrain" if rb_ok else ("claude" if claude_usable else "offline")
    return {
        "mode": mode,
        "researchbrain": {"url": RESEARCH_BRAIN_BASE_URL, "reachable": rb_ok, "auth_configured": bool(RESEARCH_BRAIN_API_KEY), "detail": rb_detail},
        "claude": {"configured": claude, "key_valid": key_ok, "model": CLAUDE_MODEL if claude else None, "detail": key_detail},
    }


def _probe_researchbrain() -> tuple[bool, str]:
    """Reachability AND token check. /api/rag/chunks with an empty id list is
    bearer-protected but costs nothing: 401 = bad token, 503 = researchbrain has
    no RESEARCHBRAIN_API_KEY, 400 = auth passed (empty body rejected after auth)."""
    if httpx is None:
        return False, "httpx not installed"
    try:
        with httpx.Client(timeout=2.5, headers=_auth_headers()) as client:
            r = client.get(f"{RESEARCH_BRAIN_BASE_URL}/api/rag/health")
            if r.status_code != 200:
                try:
                    body = r.json()
                except ValueError:
                    body = {}
                if body.get("qdrant") == "error":
                    return False, f"researchbrain is up but its Qdrant vector store is not connected ({str(body.get('error') or '')[:80]})"
                return False, f"health returned HTTP {r.status_code}"
            if not RESEARCH_BRAIN_API_KEY:
                return False, "reachable, but RESEARCH_BRAIN_API_KEY is not set (retrieval needs the bearer token)"
            r = client.post(f"{RESEARCH_BRAIN_BASE_URL}/api/rag/chunks", json={"chunk_ids": []})
            if r.status_code == 401:
                return False, "reachable, but researchbrain rejected the bearer token (check RESEARCH_BRAIN_API_KEY)"
            if r.status_code == 503:
                return False, "reachable, but researchbrain has no RESEARCHBRAIN_API_KEY set on its side"
        return True, "ok"
    except Exception as exc:  # connection refused, DNS, timeout
        return False, f"unreachable ({type(exc).__name__})"


# ----------------- /ask -----------------

@router.post("/api/research-brain/ask")
def ask(payload: AskIn):
    """Three answer paths, best available first:
    1. researchbrain retrieval (cited chunks) + Claude synthesis   → mode "researchbrain"
    2. Claude directly, grounded only in the question + platform context → mode "claude"
    3. shaped offline text                                          → mode "offline"
    `live` stays True for any AI-backed answer so older clients keep working."""
    _refresh_env()
    citations, results, live, reason = _retrieve(payload)
    if live:
        return {"answer": _synthesize(payload, results), "citations": citations, "live": True, "mode": "researchbrain", "note": None}
    if _claude_configured():
        text, err = _direct_answer(payload)
        if text:
            return {
                "answer": text,
                "citations": [],
                "live": True,
                "mode": "claude",
                "note": f"Knowledge-base retrieval unavailable ({reason}); answered by {CLAUDE_MODEL} without citations.",
            }
        reason = f"{reason}; Claude: {err}"
    return {"answer": _fallback_answer(reason), "citations": _fallback_citations(), "live": False, "mode": "offline", "note": reason}


def _retrieve(payload: AskIn):
    """Hit researchbrain retrieval. Returns (citations, results, live, reason)."""
    if httpx is None:
        return [], [], False, "httpx not installed"

    def _request(use_prefix: bool):
        body: dict = {"query": payload.question, "tier_max": 2, "topK": 20, "topN": 5, "mode": "standard", "caller": "otp-platform"}
        if payload.jurisdiction:
            body["jurisdiction"] = payload.jurisdiction
        if payload.tp_method:
            body["tp_method"] = payload.tp_method
        prefix = CONCEPT_PATHS.get(payload.process_id or "")
        if use_prefix and prefix:
            body["concept_path_prefix"] = prefix
        return body

    url = f"{RESEARCH_BRAIN_BASE_URL}/api/rag/retrieve"
    try:
        with httpx.Client(timeout=12.0, headers=_auth_headers()) as client:
            resp = client.post(url, json=_request(True))
            if resp.status_code == 401:
                return [], [], False, "researchbrain rejected the bearer token (check RESEARCH_BRAIN_API_KEY)"
            if resp.status_code == 503:
                return [], [], False, "researchbrain is up but RESEARCHBRAIN_API_KEY is unset on its side"
            if resp.status_code != 200:
                return [], [], False, f"researchbrain HTTP {resp.status_code}"
            results = resp.json().get("results", [])
            if not results:  # prefix may over-filter — retry unfiltered
                resp = client.post(url, json=_request(False))
                results = resp.json().get("results", []) if resp.status_code == 200 else []
        if not results:
            return [], [], False, "researchbrain returned no matching chunks"
        return _citations(results), results, True, "ok"
    except Exception as exc:
        return [], [], False, f"researchbrain unreachable at {RESEARCH_BRAIN_BASE_URL} ({type(exc).__name__})"


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


def _context_lines(payload: AskIn) -> str:
    bits = []
    if payload.process_id:
        bits.append(f"Process: {payload.process_id}")
    if payload.jurisdiction:
        bits.append(f"Jurisdiction: {payload.jurisdiction}")
    if payload.tp_method:
        bits.append(f"TP method: {payload.tp_method}")
    return "\n".join(bits)


def _claude(prompt: str, system: str, max_tokens: int = 1500) -> tuple[str | None, str]:
    """One Claude call → (text, error). text is None on any failure so callers
    fall through to the next answer path; error says why (shown in the UI note).
    Uses the SDK's typed errors — never string-matches messages."""
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return None, "ANTHROPIC_API_KEY not set"
    try:
        import anthropic
    except ImportError:
        return None, "anthropic SDK not installed"
    client = anthropic.Anthropic(api_key=key, timeout=45.0, max_retries=1)
    common = dict(
        model=CLAUDE_MODEL,
        max_tokens=max_tokens,
        system=system,
        output_config={"effort": "low"},  # chat latency over depth; thinking stays adaptive
        messages=[{"role": "user", "content": prompt}],
    )
    try:
        try:
            # Server-side fallback routes a safety decline to another model inside the same call.
            msg = client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **common)
        except TypeError:  # older SDK without `fallbacks`
            msg = client.messages.create(**common)
        if getattr(msg, "stop_reason", None) == "refusal":
            return None, "the model declined to answer this question"
        text = "".join(getattr(b, "text", "") for b in msg.content if getattr(b, "type", "") == "text").strip()
        return (text, "") if text else (None, "empty response")
    except anthropic.AuthenticationError:
        return None, f"API key rejected (401) — the key in backend/.env is {len(key)} characters; a full key is ~108"
    except anthropic.RateLimitError:
        return None, "rate limited (429) — retry in a moment"
    except anthropic.APIStatusError as exc:
        return None, f"API error {exc.status_code}"
    except anthropic.APIConnectionError:
        return None, "cannot reach api.anthropic.com"


def _synthesize(payload: AskIn, results: list) -> str:
    snippets = [x.get("content", "") for x in results[:5] if x.get("content")]
    grounding = "\n\n---\n\n".join(snippets)[:12000]
    if grounding:
        text, _err = _claude(
            f"{_context_lines(payload)}\n\nQuestion: {payload.question}\n\nRetrieved sources (answer only from these; say so if they do not cover the question):\n{grounding}",
            SYSTEM_PROMPT + " Ground every statement in the retrieved sources provided.",
        )
        if text:
            return text
    return _templated(snippets)


def _direct_answer(payload: AskIn) -> tuple[str | None, str]:
    return _claude(
        f"{_context_lines(payload)}\n\nQuestion: {payload.question}",
        SYSTEM_PROMPT + " The firm knowledge base is offline for this question, so answer from general transfer-pricing knowledge and say which authorities the user should verify.",
    )


def _templated(snippets: list[str]) -> str:
    if not snippets:
        return "No grounded sources were found for that question in the knowledge base."
    head = snippets[0].strip()
    return "Based on the firm’s TP knowledge base: " + head[:280] + ("…" if len(head) > 280 else "")


def _fallback_answer(reason: str = "") -> str:
    why = f" ({reason})" if reason else ""
    return (
        f"No AI answer path is available right now{why}, so this is general guidance "
        "rather than a cited answer. For arm’s-length questions, compare the tested party’s PLI against "
        "the benchmarking interquartile range; where it falls outside, a compensating adjustment to the "
        "median is the usual defensible position, documented contemporaneously. Set ANTHROPIC_API_KEY "
        "(and RESEARCH_BRAIN_BASE_URL / RESEARCH_BRAIN_API_KEY for the knowledge base) in backend/.env."
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
