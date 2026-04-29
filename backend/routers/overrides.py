"""Policy override CRUD."""

from __future__ import annotations

from fastapi import APIRouter

from persistence import overrides as store
from schemas.policy import PolicyOverrideIn

router = APIRouter()


@router.get("/api/overrides/policy")
def get_policy_overrides():
    return store.list_policy_overrides()


@router.put("/api/overrides/policy/{flow_id}")
def put_policy_override(flow_id: str, payload: PolicyOverrideIn):
    return store.upsert_policy_override(flow_id, payload.model_dump(exclude_none=True))
