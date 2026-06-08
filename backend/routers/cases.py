"""Governance Case Workspace API (OTP-30/31/40/50)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

import state.cases as cases
from schemas.state import CaseIn, CaseStatusIn, CaseStepIn

router = APIRouter()


@router.get("/api/cases")
def get_cases(process_id: str | None = None, status: str | None = None):
    return cases.list_cases(process_id=process_id, status=status)


@router.get("/api/cases/{case_id}")
def get_case(case_id: str):
    case = cases.get_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail=f"unknown case: {case_id}")
    return case


@router.post("/api/cases")
def create_case(payload: CaseIn):
    return cases.create_case(**payload.model_dump(exclude={"actor"}), actor=payload.actor)


@router.patch("/api/cases/{case_id}/status")
def set_status(case_id: str, payload: CaseStatusIn):
    try:
        return cases.set_status(case_id, payload.status, payload.actor)
    except ValueError as e:
        raise HTTPException(status_code=404 if "unknown" in str(e) else 409, detail=str(e))


@router.patch("/api/cases/{case_id}/checklist")
def set_checklist_step(case_id: str, payload: CaseStepIn):
    try:
        return cases.set_checklist_step(case_id, payload.step_key, payload.done, payload.actor)
    except ValueError as e:
        raise HTTPException(status_code=404 if "unknown" in str(e) else 400, detail=str(e))
