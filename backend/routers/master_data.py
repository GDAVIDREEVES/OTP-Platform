"""Master Data workspace — the front of the close cycle."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from state import master_data as md
from schemas.state import EntityFunctionIn, MappingDecisionIn, MappingSubmitIn, OverlayIn, PromoteFlowIn
from services.mapping_ai import propose_mapping
from state import review

router = APIRouter()


@router.get("/api/master-data/functions")
def functions():
    return md.functions()


@router.get("/api/master-data/transaction-types")
def transaction_types():
    return md.transaction_types()


@router.get("/api/master-data/entities")
def entities():
    return md.entity_master()


@router.get("/api/master-data/matrix")
def matrix():
    return md.matrix()


@router.put("/api/master-data/overlay/{ctx_id}")
def put_overlay(ctx_id: str, body: OverlayIn):
    patch = body.model_dump(exclude_none=True, exclude={"actor"})
    return md.set_overlay(ctx_id, patch, actor=body.actor)


@router.post("/api/master-data/entity-function")
def post_entity_function(body: EntityFunctionIn):
    return md.add_entity_function(
        rbukrs=body.rbukrs, tp_function_code=body.tp_function_code,
        tested_party=body.tested_party, applies_to=body.applies_to,
        is_primary=body.is_primary, actor=body.actor,
    )


@router.get("/api/master-data/staging")
def staging():
    return md.list_staging()


@router.post("/api/master-data/staging/promote")
def promote(body: PromoteFlowIn):
    md.add_staging_batch([{
        "id": body.flow_id,
        "kind": "unplanned_transaction",
        "raw": {
            "payer_rbukrs": body.payer_rbukrs,
            "counterparty_rbukrs": body.counterparty_rbukrs,
            "label": body.label or "Unplanned intercompany flow",
            "amount": body.amount,
        },
    }])
    return {"id": body.flow_id, "status": "unmapped"}


@router.post("/api/master-data/staging/simulate")
def simulate():
    return md.simulate_delta()


@router.post("/api/master-data/staging/{item_id}/propose")
def propose(item_id: str):
    item = md.get_staging(item_id)
    if item is None:
        raise HTTPException(404, f"no staging item {item_id}")
    out = propose_mapping(item)
    md.set_proposal(item_id, out)
    from state import audit
    ev = audit.record(
        actor=audit.ASSISTANT_ACTOR, actor_kind="assistant", process_id="MASTER-DATA",
        record_ref=f"mdmap:{item_id}", event_type="prepared", rationale=out.get("rationale"),
    )
    return {**out, "event_id": ev["id"]}


@router.post("/api/master-data/staging/{item_id}/submit")
def submit(item_id: str, body: MappingSubmitIn):
    item = md.get_staging(item_id)
    if item is None:
        raise HTTPException(404, f"no staging item {item_id}")
    md.mark_status(item_id, "in_review", maker=body.maker)
    review.create_item(process_id="MASTER-DATA", record_ref=f"mdmap:{item_id}", maker=body.maker)
    return {"id": item_id, "status": "in_review"}


def _review_item_id(record_ref: str) -> int | None:
    from state.engine import get_conn
    r = get_conn().execute(
        "SELECT id FROM review_items WHERE record_ref=? AND status='pending' ORDER BY id DESC LIMIT 1",
        (record_ref,),
    ).fetchone()
    return r["id"] if r else None


# The in-page approve/reject are THIN DELEGATES onto review.decide(): it enforces
# SoD (checker!=maker, AI-never-checker, reject-needs-comment) AND owns the mapping
# side-effect (apply on approve / mark rejected on reject). This route and the
# universal /review queue therefore converge on ONE side-effect — no double-apply.
@router.post("/api/master-data/staging/{item_id}/approve")
def approve(item_id: str, body: MappingDecisionIn):
    rid = _review_item_id(f"mdmap:{item_id}")
    if rid is None:
        raise HTTPException(404, f"no pending review for {item_id}")
    try:
        review.decide(rid, body.checker, "approve", body.comments)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return md.get_staging(item_id)


@router.post("/api/master-data/staging/{item_id}/reject")
def reject(item_id: str, body: MappingDecisionIn):
    rid = _review_item_id(f"mdmap:{item_id}")
    if rid is None:
        raise HTTPException(404, f"no pending review for {item_id}")
    try:
        review.decide(rid, body.checker, "reject", body.comments)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return md.get_staging(item_id)
