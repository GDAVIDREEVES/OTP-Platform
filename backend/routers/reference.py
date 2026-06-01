"""Reference data — read-only seed sets consumed by the marquee modules."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from state import seeds

router = APIRouter()


@router.get("/api/reference/{name}")
def reference(name: str):
    try:
        return seeds.load(name)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown reference set: {name}")
