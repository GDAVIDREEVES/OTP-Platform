"""US documentation & return-input workpapers — one per-entity rollup of the
covered transactions, served to OTP-37 (IRC §6662), OTP-32 (Local File) and
OTP-33 (Master File).

The rollup DERIVES entirely from the existing master-data composition
(``state.master_data.matrix()``, itself built over ``segment_pl`` / ``journal``
via ``db.q`` and the covered-transaction seeds) — no hardcoded financials. Each
covered transaction is rolled up under its tested party with its FAR/function,
best method, benchmark range (reference benchmarks) and a linked evidence ref
(``doc:<rbukrs>``) that the existing ``/api/evidence`` packet resolves to the
entity's audit history + ACDOCA postings + chain integrity.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from state import master_data as md

router = APIRouter()


def _entity_index() -> dict[str, dict[str, Any]]:
    """rbukrs -> identity + primary FAR/function, from the master."""
    out: dict[str, dict[str, Any]] = {}
    for r in md.entity_master():
        rb = r["rbukrs"]
        cur = out.get(rb)
        # Keep the primary (or first-seen) function row as the entity's headline FAR.
        if cur is None or (r.get("is_primary") and not cur.get("is_primary")):
            out[rb] = r
    return out


def _covered_for(rbukrs: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Covered transactions where this entity is the tested party — the rows
    that belong in its documentation workpaper."""
    out = []
    for c in rows:
        if c.get("status") == "unmapped":
            continue  # not yet a covered transaction; excluded from documentation
        if (c.get("tested") or {}).get("rbukrs") != rbukrs:
            continue
        out.append({
            "ctx_id": c["ctx_id"],
            "txn_type_id": c["txn_type_id"],
            "txn_label": c["txn_label"],
            "category": c["category"],
            "method": c["method"],
            "pli": c["pli"],
            "lower": c["lower"],
            "median": c["median"],
            "upper": c["upper"],
            "unit": c["unit"],
            "actual": c["actual"],
            "status": c["status"],
            "oecd_anchor": c["oecd_anchor"],
            "benchmark_set_id": c["benchmark_set_id"],
            "policy_ref": c["policy_ref"],
            "ica_ref": c["ica_ref"],
            "apa_ref": c["apa_ref"],
            "payer": c["payer"],
            "payee": c["payee"],
            "tested": c["tested"],
            # Linked evidence: the existing /api/evidence packet resolves this
            # ref to the tested entity's audit history + ACDOCA postings + chain.
            "evidence_ref": f"doc:{rbukrs}",
        })
    return out


@router.get("/api/documentation")
def documentation() -> dict[str, Any]:
    """Per-entity covered-transaction rollup for the documentation workpapers.

    For each entity that is the tested party on at least one covered
    transaction: its SAP identity, headline FAR/function, and the covered
    transactions (method -> benchmark range -> linked evidence ref). Drives the
    §6662 / Local File / Master File compositions without any module re-deriving
    the master-data join.
    """
    rows = md.matrix()
    idx = _entity_index()
    # Tested parties present in the covered set, in a stable display order.
    tested_ids = []
    seen: set[str] = set()
    for c in rows:
        if c.get("status") == "unmapped":
            continue
        rb = (c.get("tested") or {}).get("rbukrs")
        if rb and rb not in seen:
            seen.add(rb)
            tested_ids.append(rb)

    entities = []
    for rb in tested_ids:
        ident = idx.get(rb, {})
        covered = _covered_for(rb, rows)
        in_range = sum(1 for c in covered if c["status"] == "in_range")
        review = sum(1 for c in covered if c["status"] == "review")
        entities.append({
            "rbukrs": rb,
            "display_name": ident.get("display_name", f"Entity {rb}"),
            "country": ident.get("country"),
            "functional_currency": ident.get("functional_currency"),
            "tp_function_code": ident.get("tp_function_code"),
            "tp_function_label": ident.get("tp_function_label"),
            "tested_party": ident.get("tested_party", True),
            "covered": covered,
            "covered_count": len(covered),
            "in_range": in_range,
            "review": review,
            "evidence_ref": f"doc:{rb}",
        })

    totals = {
        "entities": len(entities),
        "covered": sum(e["covered_count"] for e in entities),
        "in_range": sum(e["in_range"] for e in entities),
        "review": sum(e["review"] for e in entities),
    }
    return {"entities": entities, "totals": totals}
