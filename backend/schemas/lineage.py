"""Request body for the cross-process lineage endpoint."""

from __future__ import annotations

from pydantic import BaseModel


class LineageIn(BaseModel):
    """A cross-process handoff: who passed what (record_ref) from where to where."""

    record_ref: str
    from_process: str
    to_process: str
    actor: str
    summary: str
