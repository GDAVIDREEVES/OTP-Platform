"""Request bodies for the calc-graph (Model Canvas) endpoints (Phase 7 MC1).

A graph is loosely typed JSON (nodes + edges) — the typed validation lives in
``calc/graph.py``, not in Pydantic, so the API returns the same precise
``{message, node_id}`` errors the canvas needs rather than a 422.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class GraphIn(BaseModel):
    """A canvas graph to validate or preview (nothing persists).

    ``overrides`` is an OPTIONAL scenario overlay (param key -> what-if value):
    when present the preview re-evaluates under the EXISTING
    ``state.parameters.overrides`` contextvar — the same overlay a scenario run
    uses — so the cockpit's Base⟷Scenario toggle reuses the engine unchanged.
    Omitted/empty it is a no-op and the preview is byte-identical to the base.
    """

    graph: dict[str, Any]
    overrides: dict[str, Any] | None = None
