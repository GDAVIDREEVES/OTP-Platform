"""Master Data workspace — the front of the close cycle."""
from __future__ import annotations

from fastapi import APIRouter

from state import master_data as md
from schemas.state import EntityFunctionIn, OverlayIn

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
