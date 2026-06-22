"""Request bodies for the calc-graph (Model Canvas) endpoints (Phase 7 MC1).

A graph is loosely typed JSON (nodes + edges) — the typed validation lives in
``calc/graph.py``, not in Pydantic, so the API returns the same precise
``{message, node_id}`` errors the canvas needs rather than a 422.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class GraphIn(BaseModel):
    """A canvas graph to validate or preview (nothing persists)."""

    graph: dict[str, Any]
