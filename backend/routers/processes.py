"""Process catalog — the OTP-1…50 registry and pharma overlay."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from state import processes as catalog

router = APIRouter()


@router.get("/api/processes")
def get_processes():
    return {"categories": catalog.categories(), "processes": catalog.list_processes()}


@router.get("/api/processes/{otp_id}")
def get_process(otp_id: str):
    process = catalog.get_process(otp_id)
    if process is None:
        raise HTTPException(status_code=404, detail=f"Process {otp_id} not found")
    return process
