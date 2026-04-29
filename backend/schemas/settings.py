"""Pydantic input model for /api/settings."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class SettingsIn(BaseModel):
    model_config = ConfigDict(extra="allow")

    companyName: str | None = None
    defaultCurrency: str | None = None
    defaultReviewer: str | None = None
    notifyOnDeviation: bool | None = None
