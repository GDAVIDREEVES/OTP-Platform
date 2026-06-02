"""Inbound SAP-mapping proposer.

Tiered like the Research Brain: a deterministic by-analogy heuristic always
produces a defensible proposal (offline-safe); when ANTHROPIC_API_KEY is set the
rationale may be refined by Claude. NEVER auto-applies — the result is a proposal
a human signs off on.
"""
from __future__ import annotations

import os
from typing import Any

# keyword -> (function code, label fragment used in the rationale)
_FUNCTION_KEYWORDS = [
    ("distribut", "LRD"),
    ("toll", "TOLL"),
    ("contract man", "TOLL"),
    ("manufactur", "FRMFG"),
    ("financ", "TREAS"),
    ("treasur", "TREAS"),
    ("service", "SVC"),
    ("principal", "PRIN"),
    ("licens", "IPOWN"),
    ("ip ", "IPOWN"),
]
_TESTED = {"LRD", "TOLL", "FRMFG", "SVC"}

_ACCOUNT_KEYWORDS = [
    (("royalt", "trademark"), "ROY-TM"),
    (("royalt", "trade mark"), "ROY-TM"),
    (("royalt", "api"), "ROY-API"),
    (("royalt",), "ROY-API"),
    (("interest",), "FIN"),
    (("service",), "SVC"),
]
_TXN_KEYWORDS = [
    (("r&d",), "SVC"),
    (("research",), "SVC"),
    (("service",), "SVC"),
    (("royalt",), "ROY-API"),
    (("distribut",), "DIST-LRD"),
    (("manufactur",), "MFG-TOLL"),
]


def _match(text: str, table) -> str | None:
    t = text.lower()
    for keys, code in table:
        if isinstance(keys, str):
            if keys in t:
                return code
        elif all(k in t for k in keys):
            return code
    return None


def _propose_entity(raw: dict[str, Any]) -> dict[str, Any]:
    name = str(raw.get("name", ""))
    code = None
    for frag, c in _FUNCTION_KEYWORDS:
        if frag in name.lower():
            code = c
            break
    if code is None:
        return {
            "proposed": {"tp_function_code": "PRIN", "tested_party": False, "applies_to": []},
            "confidence": "Low",
            "rationale": f"Could not infer a characterisation for '{name}' from its name; defaulting to Principal — please set the correct function.",
        }
    proposed = {
        "tp_function_code": code,
        "tested_party": code in _TESTED,
        "applies_to": {"LRD": ["Distribution"], "TOLL": ["Manufacturing"], "FRMFG": ["Manufacturing"], "SVC": ["Services"]}.get(code, []),
        "country": raw.get("country_hint"),
        "functional_currency": raw.get("currency"),
    }
    return {
        "proposed": proposed,
        "confidence": "High" if code == "LRD" else "Medium",
        "rationale": (
            f"RBUKRS {raw.get('rbukrs')} '{name}' matches the naming and routing of the existing "
            f"distributors (3200/3300/3800); characterised as {code} by analogy."
            if code == "LRD" else
            f"'{name}' indicates a {code} characterisation by name; confirm against its functional profile."
        ),
    }


def propose_mapping(item: dict[str, Any]) -> dict[str, Any]:
    kind = item["kind"]
    raw = item["raw"]
    if kind == "entity":
        out = _propose_entity(raw)
    elif kind == "account":
        code = _match(str(raw.get("text", "")), _ACCOUNT_KEYWORDS)
        out = {
            "proposed": {"txn_type_id": code} if code else {"txn_type_id": None},
            "confidence": "High" if code else "Low",
            "rationale": f"Account text '{raw.get('text')}' maps to transaction type {code}." if code
                         else f"Could not classify account '{raw.get('account')}'; assign a transaction type.",
        }
    elif kind == "transaction":
        code = _match(str(raw.get("label", "")), _TXN_KEYWORDS)
        out = {
            "proposed": {"txn_type_id": code} if code else {"txn_type_id": None},
            "confidence": "Medium" if code else "Low",
            "rationale": f"'{raw.get('label')}' best matches transaction type {code}." if code
                         else f"Could not classify transaction '{raw.get('label')}'.",
        }
    elif kind == "unplanned_transaction":
        code = _match(str(raw.get("label", "")), _TXN_KEYWORDS)
        out = {
            "proposed": {"txn_type_id": code, "tested_rbukrs": raw.get("payer_rbukrs")} if code else {"txn_type_id": None},
            "confidence": "Medium" if code else "Low",
            "rationale": (
                f"Unexpected IC flow {raw.get('payer_rbukrs')}→{raw.get('counterparty_rbukrs')} "
                f"'{raw.get('label')}' best matches transaction type {code}; assign policy / ICA / APA on review."
                if code else f"Could not classify the unexpected flow '{raw.get('label')}'; assign a transaction type."
            ),
        }
    else:
        out = {"proposed": {}, "confidence": "Low", "rationale": f"Unsupported kind '{kind}'."}

    out["live"] = False
    out["citations"] = [{"source": "OECD TPG Ch. I–III", "note": "functional analysis & method selection"}]
    return _maybe_refine(item, out)


def _maybe_refine(item: dict[str, Any], out: dict[str, Any]) -> dict[str, Any]:
    """Optionally let Claude rewrite the rationale; never changes the proposal."""
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return out
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=key)
        msg = client.messages.create(
            model=os.getenv("OTP_CLAUDE_MODEL", "claude-3-5-haiku-latest"),
            max_tokens=160,
            system="You are a transfer-pricing assistant. In <=2 sentences, justify the proposed mapping. Do not change it.",
            messages=[{"role": "user", "content": f"Item: {item}\nProposed: {out['proposed']}\nCurrent rationale: {out['rationale']}"}],
        )
        text = "".join(getattr(b, "text", "") for b in msg.content).strip()
        if text:
            out["rationale"] = text
            out["live"] = True
    except Exception:
        pass
    return out
