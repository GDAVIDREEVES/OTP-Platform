"""App-wide settings."""

from __future__ import annotations

from fastapi import APIRouter

from persistence import overrides as store
from schemas.settings import SettingsIn

router = APIRouter()


@router.get("/api/settings")
def get_settings():
    return store.get_settings()


@router.put("/api/settings")
def put_settings(payload: SettingsIn):
    return store.update_settings(payload.model_dump(exclude_none=True))
