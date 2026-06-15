"""User-authored calculation API (Phase 5 W3 — Calculation Builder backend).

Thin router over ``state/user_calcs.py`` (draft → tested → in_review → active
lifecycle) and ``calc/expr.py`` (the safe expression engine). Route order
matters: the literal ``/api/user-calcs/validate`` and
``/api/user-calcs/preview`` routes are registered before the parameterised
``/api/user-calcs/{ucalc_id}`` routes.

``validate`` and ``preview`` are pure reads — nothing persists, nothing is
audited — so the W4 wizard can syntax-check and "Show" on every keystroke.
Activation itself happens in the /review queue (a different checker approves
the ``ucalc:{id}`` item; see state/review.py:decide()).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

import calc.expr as expr
import calc.trace as trace
import state.user_calcs as user_calcs
from schemas.user_calcs import (
    ExpressionIn,
    PreviewIn,
    SubmitActivationIn,
    TestRunIn,
    UserCalcIn,
    UserCalcPatch,
)

router = APIRouter()


def _http_error(e: ValueError) -> HTTPException:
    msg = str(e)
    if msg.startswith("unknown user calculation"):
        return HTTPException(status_code=404, detail=msg)
    if msg.startswith("invalid expression") or msg.startswith("invalid output_grain"):
        return HTTPException(status_code=400, detail=msg)
    return HTTPException(status_code=409, detail=msg)


@router.get("/api/user-calcs")
def list_user_calcs(status: str | None = None):
    return user_calcs.list_user_calcs(status=status)


@router.get("/api/user-calcs/terms")
def term_metadata():
    """Term-picker metadata for the W4 Builder: the measure allowlist
    (tables/columns/grains/filters straight from ``calc.expr.MEASURE_TABLES`` —
    the same registry validate/preview enforce, so the picker can never drift),
    the legal output grains and the calc ids ``calc()`` may not compose."""
    return {
        "grains": list(expr.GRAINS),
        "measures": [
            {
                "table": table,
                "catalog_id": spec["catalog_id"],
                "measures": list(spec["measures"]),
                "grains": {g: list(cols) for g, cols in spec["grains"].items()},
                "filters": spec["filters"],
            }
            for table, spec in expr.MEASURE_TABLES.items()
        ],
        # expr enforces this at validate/evaluate time; surfacing it keeps the
        # picker from offering a calc whose composition would be rejected.
        "non_composable": sorted(expr._NON_COMPOSABLE),
    }


@router.post("/api/user-calcs/validate")
def validate_expression(payload: ExpressionIn):
    """Syntax + term-resolution report: ``{ok, errors: [{message, pos}], terms}``."""
    return expr.validate(payload.expression)


@router.post("/api/user-calcs/preview")
def preview_expression(payload: PreviewIn):
    """Evaluate an expression and return result + trace — nothing persists."""
    with trace.collect() as steps:
        try:
            value = expr.evaluate(payload.expression)
        except expr.ExprError as e:
            raise HTTPException(
                status_code=400, detail={"message": e.message, "pos": e.pos}
            )
    return {
        "result": expr.to_jsonable(value),
        "grain": expr.result_grain(value),
        "trace": list(steps),
    }


@router.post("/api/user-calcs")
def create_user_calc(payload: UserCalcIn):
    try:
        return user_calcs.create_user_calc(
            name=payload.name, expression=payload.expression,
            description=payload.description, process_id=payload.process_id,
            output_grain=payload.output_grain, actor=payload.actor,
        )
    except ValueError as e:
        raise _http_error(e)


@router.get("/api/user-calcs/{ucalc_id}")
def get_user_calc(ucalc_id: str):
    u = user_calcs.get_user_calc(ucalc_id)
    if u is None:
        raise HTTPException(status_code=404, detail=f"unknown user calculation: {ucalc_id}")
    return u


@router.patch("/api/user-calcs/{ucalc_id}")
def update_user_calc(ucalc_id: str, payload: UserCalcPatch):
    try:
        return user_calcs.update_user_calc(
            ucalc_id, actor=payload.actor, name=payload.name,
            description=payload.description, expression=payload.expression,
            output_grain=payload.output_grain, process_id=payload.process_id,
        )
    except ValueError as e:
        raise _http_error(e)


@router.post("/api/user-calcs/{ucalc_id}/test")
def test_user_calc(ucalc_id: str, payload: TestRunIn):
    """Test-run the draft: evaluate (traced) and mark it ``tested`` on success
    — the gate submit-activation requires."""
    try:
        return user_calcs.test_run(ucalc_id, actor=payload.actor)
    except expr.ExprError as e:
        raise HTTPException(status_code=400, detail={"message": e.message, "pos": e.pos})
    except ValueError as e:
        raise _http_error(e)


@router.post("/api/user-calcs/{ucalc_id}/submit-activation")
def submit_activation(ucalc_id: str, payload: SubmitActivationIn):
    """Submit for activation: status -> in_review + one pending maker-checker
    item at ucalc:{id}. The calculation goes live only when a DIFFERENT
    reviewer approves the item in the /review queue."""
    try:
        return user_calcs.submit_for_activation(ucalc_id, maker=payload.maker)
    except ValueError as e:
        raise _http_error(e)
