"""Cross-process lineage — handoff write + timeline-feed read.

POST /api/lineage           record one cross-process handoff (rides audit.record)
GET  /api/lineage/{ref}     the lineage/timeline feed for a record_ref
"""

from __future__ import annotations

import state.lineage as lineage
from fastapi import APIRouter
from schemas.lineage import LineageIn

router = APIRouter()


@router.post("/api/lineage")
def record_handoff(payload: LineageIn):
    return lineage.record_handoff(**payload.model_dump())


@router.get("/api/lineage/{record_ref:path}")
def get_lineage(record_ref: str):
    return lineage.list_handoffs(record_ref)
