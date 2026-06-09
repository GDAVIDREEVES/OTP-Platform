"""Governed parameter store API (Phase 2a / OTP-49 console)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

import state.parameters as parameters
from schemas.parameters import ParamPatch, ParamReset

router = APIRouter()


@router.get("/api/parameters")
def list_parameters(category: str | None = None):
    return parameters.list_params(category=category)


@router.get("/api/parameters/{key}")
def get_parameter(key: str):
    param = parameters.get_param_row(key)
    if param is None:
        raise HTTPException(status_code=404, detail=f"unknown parameter: {key}")
    return param


@router.patch("/api/parameters/{key}")
def set_parameter(key: str, payload: ParamPatch):
    try:
        return parameters.set_param(key, payload.value, payload.actor, payload.rationale)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/api/parameters/{key}/reset")
def reset_parameter(key: str, payload: ParamReset):
    try:
        return parameters.reset_param(key, payload.actor)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
