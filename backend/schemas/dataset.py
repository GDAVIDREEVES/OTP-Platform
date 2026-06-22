"""Request bodies for the dataset / data-prep endpoints (Phase 8 DS1).

A dataset graph is loosely-typed JSON (nodes + edges) — the typed validation
lives in ``calc/dataset.py`` (the allowlist compiler), so the API returns the
same precise ``{message, node_id}`` errors the canvas needs rather than a 422.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class DatasetIn(BaseModel):
    """A dataset graph to validate or preview (nothing persists)."""

    graph: dict[str, Any]


class DatasetPreviewIn(DatasetIn):
    """A dataset graph plus an optional sample row cap for the preview."""

    sample_limit: int = 100


class AuthoredDatasetIn(BaseModel):
    """Create a draft authored dataset (DS2). ``definition`` is the data-prep
    graph (the source of truth; validated by ``calc/dataset.py``'s allowlist
    compiler — the schema stays thin so it never drifts)."""

    name: str
    definition: dict[str, Any]
    actor: str
    description: str | None = None
    process_id: str | None = None


class AuthoredDatasetPatch(BaseModel):
    """Edit an authored dataset (drafts in place; an active dataset versions +
    returns to draft) — any graph change invalidates the test gate."""

    actor: str
    name: str | None = None
    description: str | None = None
    definition: dict[str, Any] | None = None
    process_id: str | None = None


class DatasetActorIn(BaseModel):
    actor: str


class DatasetMakerIn(BaseModel):
    maker: str
