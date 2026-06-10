"""Trace collector for calculation runs (Calc Studio CS-a).

A contextvar-scoped step collector: ``calc_registry.run()`` opens a
``collect()`` context around the handler call, and instrumented primitives —
``parameters.get_param`` ("param"), ``warehouse.aggregate`` ("aggregate"),
``allocation.allocate`` ("allocate"), ``bands.evaluate_band`` ("band") — call
``emit()`` as they execute. Outside a ``collect()`` block ``emit()`` is a
no-op, so ordinary HTTP request handling is completely unaffected.

Stdlib-only by design: ``state/parameters.py`` and the calc kernels import this
module, so it must never import anything from the project (no cycles).
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator

_COLLECTOR: ContextVar[list[dict[str, Any]] | None] = ContextVar(
    "calc_trace_collector", default=None
)


@contextmanager
def collect() -> Iterator[list[dict[str, Any]]]:
    """Activate a fresh step collector for the enclosed block.

    Yields the (mutable) list that ``emit()`` appends to; the previous
    collector (normally ``None``) is restored on exit even on error, so a
    failing handler cannot leak its collector into later requests.
    """
    steps: list[dict[str, Any]] = []
    token = _COLLECTOR.set(steps)
    try:
        yield steps
    finally:
        _COLLECTOR.reset(token)


def emit(step: str, **detail: Any) -> None:
    """Record one trace step ``{"step": step, **detail}`` if collecting."""
    steps = _COLLECTOR.get()
    if steps is not None:
        steps.append({"step": step, **detail})
