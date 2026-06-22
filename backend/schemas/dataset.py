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
