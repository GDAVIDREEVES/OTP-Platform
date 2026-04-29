"""Display-label helpers for TP methods, flow descriptions, royalty IP categories."""

from __future__ import annotations

from typing import Any

from constants import ENTITY_DIM, MATERIAL_LABELS


def pretty_method(m: str | None) -> str:
    if not m:
        return "TNMM"
    base = m.replace("/APA", "")
    return {
        "CUP": "CUP",
        "COST_PLUS": "Cost Plus",
        "RPM": "Resale Price",
    }.get(base, base.replace("_", " ").title())


def describe_flow(r: dict[str, Any]) -> str:
    mat = MATERIAL_LABELS.get(r["MATERIAL_TYPE"], r["MATERIAL_TYPE"])
    return f"{mat}: {r['SELLER_ROLE']} → {r['BUYER_ROLE']} ({pretty_method(r['TP_METHOD'])})"


def pli_for(method: str | None) -> str:
    base = (method or "").replace("/APA", "")
    return {
        "CUP": "Comparable price",
        "COST_PLUS": "Markup on cost",
        "RPM": "Gross resale margin",
    }.get(base, "Operating margin")


def ip_category_for(matnr: str | None) -> str:
    if not matnr:
        return "Other IP"
    m = matnr.upper()
    if "TM" in m or "BRAND" in m:
        return "Distribution Trademarks"
    if "PAT" in m or "API" in m:
        return "Core Manufacturing Patents"
    if "SW" in m or "PLAT" in m:
        return "Software & Platform IP"
    return "Process Know-How"


def wht_note(licensor: str, licensee: str) -> str:
    licensor_cc = ENTITY_DIM.get(licensor, {}).get("country_code", "")
    licensee_cc = ENTITY_DIM.get(licensee, {}).get("country_code", "")
    return f"{licensee_cc}–{licensor_cc} treaty applies"
