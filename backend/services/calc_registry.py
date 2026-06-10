"""Calculation registry + runner (Calc Studio CS-a).

The registry is the committed seed ``seeds/calculations/calculations.v1.json``
— one entry per computed endpoint (definition, formula, inputs, summary keys).
The runner invokes the SAME handler functions the HTTP routes mount, directly
as plain callables, so a registry run is byte-identical to the API response
(golden-gated in tests/test_calc_registry.py).

``_RUNNERS`` hand-writes the full default kwargs for every handler. This is
deliberate: ``segment_pl`` / ``berry_trend`` declare FastAPI ``Query(...)``
objects as their Python defaults, so calling them with a parameter omitted
would pass the Query sentinel through to the SQL layer. Supplying EVERY
parameter explicitly defends against that gotcha for all 14 handlers.

Each run is wrapped in ``calc.trace.collect()`` (the instrumented primitives
record "param"/"aggregate"/"allocate"/"band" steps), persisted to the
``calc_runs`` table (digest + summary + trace — never the output body) and
hash-chained into the audit stream at ``record_ref="calc:{id}"``.
"""

from __future__ import annotations

import hashlib
import json
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

import state.audit as audit
import state.calc_runs as calc_runs
from calc import trace
from routers.beat import beat
from routers.berry import berry_trend
from routers.csa import csa, profit_split
from routers.forecast import forecast
from routers.invoices import list_invoices
from routers.pnl import segment_pl
from routers.reconciliation import reconciliation
from routers.stewardship import stewardship
from routers.transactions import list_flows, list_pricing, list_royalties
from routers.treasury import treasury
from routers.wht import wht

_DIR = Path(__file__).parent.parent / "seeds" / "calculations"

# The common PeriodFilter trio shared by the warehouse list endpoints.
_PERIOD: dict[str, Any] = {"year": None, "periodFrom": None, "periodTo": None}

# calc_id -> (handler, full default kwargs). EVERY parameter of each handler is
# supplied explicitly — see the module docstring for why.
_RUNNERS: dict[str, tuple[Callable[..., Any], dict[str, Any]]] = {
    "csa": (csa, {"year": 2026}),
    "profit_split": (profit_split, {"year": 2026, "key": "opex_rd"}),
    "beat": (beat, {"year": 2026}),
    "treasury": (treasury, {}),
    "wht": (wht, {**_PERIOD}),
    "reconciliation": (reconciliation, {**_PERIOD}),
    "forecast": (forecast, {"year": 2026}),
    "stewardship": (stewardship, {"year": 2026}),
    "flows": (list_flows, {**_PERIOD}),
    "royalties": (list_royalties, {**_PERIOD}),
    "pricing": (list_pricing, {**_PERIOD}),
    "invoices": (list_invoices, {**_PERIOD, "material_type": None}),
    "segments_pl": (segment_pl, {"entity": None, "period": None, "year": None}),
    "berry": (berry_trend, {"entity": None, "target": 1.20, **_PERIOD}),
}


@lru_cache(maxsize=None)
def _doc(name: str) -> dict[str, Any]:
    return json.loads((_DIR / name).read_text(encoding="utf-8"))


def defs() -> list[dict[str, Any]]:
    """The registry: every calculation definition from the committed seed."""
    return _doc("calculations.v1.json")["calculations"]


def get_def(calc_id: str) -> dict[str, Any] | None:
    """One calculation definition by id, or ``None`` if unknown."""
    return next((d for d in defs() if d["id"] == calc_id), None)


def _digest(output: Any) -> str:
    return hashlib.sha256(
        json.dumps(output, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()


def _summary(output: Any, summary_keys: list[str]) -> dict[str, Any]:
    """Top-level summary for the Runs table: the seed's summary_keys for dict
    outputs, the row count for list outputs."""
    if isinstance(output, dict):
        return {k: output[k] for k in summary_keys if k in output}
    return {"rows": len(output)}


def run(
    calc_id: str,
    actor: str,
    args: dict[str, Any] | None = None,
    scenario_id: str | None = None,
    scenario_overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Execute one registered calculation and persist + audit the run.

    ``args`` are merged over the handler's full default kwargs. The persisted
    row carries digest/summary/params_read/trace — the full output body is
    returned under ``"output"`` but never stored. On handler failure a
    ``failed`` row is persisted and the exception re-raised.

    ``scenario_overrides`` is plumbed for CS-c; until the parameter overlay
    lands, passing it is an explicit error rather than a silent no-op.
    """
    d = get_def(calc_id)
    if d is None:
        raise ValueError(f"unknown calculation: {calc_id}")
    if scenario_overrides is not None:
        raise ValueError("scenarios not yet enabled")

    handler, defaults = _RUNNERS[calc_id]
    kwargs = {**defaults, **(args or {})}

    t0 = time.perf_counter()
    with trace.collect() as steps:
        try:
            output = handler(**kwargs)
        except Exception as e:
            calc_runs.insert_run(
                calc_id=calc_id, actor=actor, status="failed",
                scenario_id=scenario_id, args=kwargs,
                duration_ms=int((time.perf_counter() - t0) * 1000),
                params_read=[s for s in steps if s["step"] == "param"],
                trace=list(steps), error=str(e),
            )
            raise

    duration_ms = int((time.perf_counter() - t0) * 1000)
    digest = _digest(output)
    params_read = [s for s in steps if s["step"] == "param"]
    summary = _summary(output, d.get("summary_keys", []))

    row = calc_runs.insert_run(
        calc_id=calc_id, actor=actor, status="succeeded",
        scenario_id=scenario_id, args=kwargs, duration_ms=duration_ms,
        output_digest=digest, summary=summary, params_read=params_read,
        trace=list(steps),
    )
    audit.record(
        actor=actor, actor_kind="human",
        record_ref=f"calc:{calc_id}", process_id=d["process_id"],
        event_type="run",
        after={
            "digest": digest,
            "duration_ms": duration_ms,
            "scenario_id": scenario_id,
            "summary": summary,
        },
    )
    return {**row, "output": output}
