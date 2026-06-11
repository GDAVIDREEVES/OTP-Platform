"""TDD for the safe expression engine (calc/expr.py, Phase 5 W3).

The keystones:

* **Decimal exactness** — literals parse to Decimal and arithmetic stays
  exact (``0.1 + 0.2 == Decimal('0.3')``, never the float artifact).
* **No eval/exec** — the module source contains no ``eval(``/``exec(``/
  ``compile(``, and hostile input (``__import__``) dies as a parse error.
* **Precise errors** — every syntax/semantic failure carries a message and a
  character position; validation COLLECTS term errors instead of stopping at
  the first.
* **Terms** — ``param`` reads the governed store (scenario-overlay aware),
  ``measure`` aggregates the warehouse through the allowlist (filter values
  always bound, never interpolated), ``calc`` composes a system calculation's
  output; all three emit trace steps.

Run from `backend/`:  python -m pytest tests/test_expr.py
"""

from __future__ import annotations

import inspect
from decimal import Decimal

import pytest

import calc.expr as expr
import calc.trace as trace
import state.parameters as parameters
from db import q

# --- Parsing & precedence --------------------------------------------------------


def test_precedence_and_parens():
    assert expr.evaluate("2 + 3 * 4") == Decimal("14")
    assert expr.evaluate("(2 + 3) * 4") == Decimal("20")
    assert expr.evaluate("2 - 3 - 4") == Decimal("-5")
    assert expr.evaluate("12 / 4 / 3") == Decimal("1")
    assert expr.evaluate("-2 * 3") == Decimal("-6")
    assert expr.evaluate("2 * -3") == Decimal("-6")
    assert expr.evaluate("-(2 + 3)") == Decimal("-5")


def test_decimal_exactness():
    v = expr.evaluate("0.1 + 0.2")
    assert isinstance(v, Decimal)
    assert v == Decimal("0.3")
    assert str(v) == "0.3"  # not 0.30000000000000004
    assert expr.evaluate("7 / 2") == Decimal("3.5")


def test_division_by_zero():
    with pytest.raises(expr.ExprEvalError, match="division by zero"):
        expr.evaluate("1 / 0")


# --- Syntax errors (message + position) -------------------------------------------


@pytest.mark.parametrize("text,fragment", [
    ("2 + * 3", "unexpected"),
    ("(2 + 3", "expected '\\)'"),
    ("2 + 3)", "unexpected"),
    ("'abc", "unterminated string"),
    ("a = 1", "use '==' for comparison"),
    ("2 @ 3", "unexpected character"),
    ("1.2.3", "malformed number"),
    ("foo(1)", "unknown function"),
    ("1 < 2 < 3", "comparison chains"),
    ("", "empty expression"),
    ("abs(1, 2)", "takes 1 argument"),
    ("if(1, 2)", "takes 3 argument"),
    ("param()", "takes 1 argument"),
])
def test_syntax_errors(text, fragment):
    with pytest.raises(expr.ExprSyntaxError, match=fragment):
        expr.parse(text)


def test_syntax_error_carries_position():
    with pytest.raises(expr.ExprSyntaxError) as ei:
        expr.parse("2 + * 3")
    assert ei.value.pos == 4


# --- No eval/exec, ever ------------------------------------------------------------


def test_no_eval_exec_in_source():
    src = inspect.getsource(expr)
    for needle in ("eval(", "exec(", "compile(", "__import__"):
        assert needle not in src, f"forbidden construct in calc/expr.py: {needle}"


def test_hostile_input_is_a_parse_error():
    with pytest.raises(expr.ExprSyntaxError, match="unknown function"):
        expr.parse("__import__('os')")
    with pytest.raises(expr.ExprError):
        expr.evaluate("__import__")  # bare name → eval error, never the builtin


# --- Type discipline ----------------------------------------------------------------


def test_bare_name_in_arithmetic_errors_with_hint():
    with pytest.raises(expr.ExprEvalError, match="did you mean param\\('revenue'\\)"):
        expr.evaluate("revenue + 1")


def test_comparison_result_not_usable_in_arithmetic():
    with pytest.raises(expr.ExprEvalError, match="comparison result"):
        expr.evaluate("(1 < 2) + 1")


def test_string_not_usable_in_arithmetic():
    with pytest.raises(expr.ExprEvalError, match="cannot use string"):
        expr.evaluate("'abc' * 2")


# --- Builtin functions --------------------------------------------------------------


def test_scalar_functions():
    assert expr.evaluate("sum(1, 2, 3)") == Decimal("6")
    assert expr.evaluate("min(3, 1, 2)") == Decimal("1")
    assert expr.evaluate("max(3, 1, 2)") == Decimal("3")
    assert expr.evaluate("abs(0 - 5)") == Decimal("5")
    assert expr.evaluate("abs(-5)") == Decimal("5")


def test_if_with_comparisons():
    assert expr.evaluate("if(2 > 1, 10, 20)") == Decimal("10")
    assert expr.evaluate("if(2 <= 1, 10, 20)") == Decimal("20")
    assert expr.evaluate("if(1 == 1, if(2 != 3, 1, 2), 3)") == Decimal("1")


def test_if_requires_comparison_condition():
    with pytest.raises(expr.ExprEvalError, match="must be a comparison"):
        expr.evaluate("if(1, 2, 3)")


# --- param() ------------------------------------------------------------------------


def test_param_reads_governed_store(state_db):
    parameters.seed_if_empty()
    assert expr.evaluate("param('csa.growth')") == Decimal("0.08")
    # Quoted strings and bare dotted names are interchangeable.
    assert expr.evaluate("param(csa.growth)") == Decimal("0.08")


def test_param_unknown_key(state_db):
    parameters.seed_if_empty()
    with pytest.raises(expr.ExprEvalError, match="unknown parameter 'nope.key'"):
        expr.evaluate("param('nope.key')")


def test_param_respects_scenario_overlay(state_db):
    parameters.seed_if_empty()
    with parameters.overrides({"csa.growth": 0.10}):
        assert expr.evaluate("param('csa.growth')") == Decimal("0.1")
    assert expr.evaluate("param('csa.growth')") == Decimal("0.08")


def test_param_rejects_non_scalar(state_db):
    parameters.seed_if_empty()
    with pytest.raises(expr.ExprEvalError, match="not a scalar"):
        expr.evaluate("param('csa.ps_participants')")


# --- measure() ----------------------------------------------------------------------


def test_measure_group_matches_warehouse(state_db):
    parameters.seed_if_empty()
    v = expr.evaluate("measure('segment_pl.revenue', 'group', 'GJAHR=2026')")
    total = q("SELECT SUM(revenue) AS r FROM segment_pl WHERE GJAHR = ?", [2026])[0]["r"]
    assert v == Decimal(str(total))


def test_measure_entity_series(state_db):
    parameters.seed_if_empty()
    v = expr.evaluate("measure('segment_pl.revenue', 'entity', 'GJAHR=2026')")
    assert isinstance(v, expr.Series)
    assert v.grain == "entity"
    assert v.key_cols == ("RBUKRS",)
    expected = {
        str(r["RBUKRS"]): r["revenue"]
        for r in q(
            "SELECT RBUKRS, SUM(revenue) AS revenue FROM segment_pl WHERE GJAHR = ? GROUP BY RBUKRS",
            [2026],
        )
    }
    assert {k[0] for k in v.values} == set(expected)
    for k, val in v.values.items():
        assert val == Decimal(str(expected[k[0]]))


def test_measure_bare_names_and_default_grain(state_db):
    parameters.seed_if_empty()
    bare = expr.evaluate("measure(segment_pl.revenue, entity, 'GJAHR=2026')")
    quoted = expr.evaluate("measure('segment_pl.revenue', 'entity', 'GJAHR=2026')")
    assert bare.values == quoted.values
    # Grain omitted == 'group' (a scalar).
    assert isinstance(expr.evaluate("measure(segment_pl.revenue)"), Decimal)


@pytest.mark.parametrize("text,fragment", [
    ("measure('nope.revenue')", "unknown measure table"),
    ("measure('segment_pl.bogus')", "unknown measure 'bogus'"),
    ("measure('segment_pl.revenue', 'galaxy')", "unknown grain"),
    ("measure('revenue')", "must look like 'table.column'"),
    ("measure('segment_pl.revenue', 'entity', 'EVIL=1')", "unknown filter column"),
    ("measure('segment_pl.revenue', 'entity', 'GJAHR=abc')", "expects an integer"),
    ("measure('segment_pl.revenue', 'entity', 'GJAHR')", "malformed filter"),
    ("measure('segment_pl.revenue', 'entity', GJAHR)", "must be a quoted string"),
])
def test_measure_static_errors(text, fragment):
    with pytest.raises(expr.ExprError, match=fragment):
        expr.evaluate(text)


def test_series_scalar_broadcast(state_db):
    parameters.seed_if_empty()
    base = expr.evaluate("measure('segment_pl.revenue', 'entity', 'GJAHR=2026')")
    doubled = expr.evaluate("measure('segment_pl.revenue', 'entity', 'GJAHR=2026') * 2")
    for k in base.values:
        assert doubled.values[k] == base.values[k] * 2


def test_series_series_alignment(state_db):
    parameters.seed_if_empty()
    twice = expr.evaluate(
        "measure('segment_pl.revenue', 'entity', 'GJAHR=2026')"
        " + measure('segment_pl.revenue', 'entity', 'GJAHR=2026')"
    )
    base = expr.evaluate("measure('segment_pl.revenue', 'entity', 'GJAHR=2026')")
    for k in base.values:
        assert twice.values[k] == base.values[k] * 2


def test_grain_mismatch_errors(state_db):
    parameters.seed_if_empty()
    with pytest.raises(expr.ExprEvalError, match="grain mismatch"):
        expr.evaluate(
            "measure('segment_pl.revenue', 'entity')"
            " + measure('segment_pl.revenue', 'entity_function')"
        )


def test_sum_reduces_series_to_group_total(state_db):
    parameters.seed_if_empty()
    reduced = expr.evaluate("sum(measure('segment_pl.revenue', 'entity', 'GJAHR=2026'))")
    total = expr.evaluate("measure('segment_pl.revenue', 'group', 'GJAHR=2026')")
    # Float association across GROUP BYs can differ in the last ulp — approx.
    assert float(reduced) == pytest.approx(float(total))


def test_measure_no_data_errors(state_db):
    parameters.seed_if_empty()
    with pytest.raises(expr.ExprEvalError, match="matched no data"):
        expr.evaluate("measure('segment_pl.revenue', 'entity', 'GJAHR=1900')")


# --- calc() composition -------------------------------------------------------------


def test_calc_composes_system_output(state_db):
    parameters.seed_if_empty()
    from routers.csa import csa

    pool = csa(year=2026)["pool"]
    assert expr.evaluate("calc('csa', 'pool')") == Decimal(str(pool))
    assert expr.evaluate("calc('csa', 'pool') * param('csa.pct_mult')") == (
        Decimal(str(pool)) * 3
    )


def test_calc_unknown_id_and_key(state_db):
    parameters.seed_if_empty()
    with pytest.raises(expr.ExprEvalError, match="unknown calculation 'nope'"):
        expr.evaluate("calc('nope', 'pool')")
    with pytest.raises(expr.ExprEvalError, match="no output key 'bogus'.*available"):
        expr.evaluate("calc('csa', 'bogus')")


def test_calc_service_allocation_not_composable(state_db):
    parameters.seed_if_empty()
    with pytest.raises(expr.ExprEvalError, match="not composable"):
        expr.evaluate("calc('service_allocation', 'anything')")


# --- Trace emission ------------------------------------------------------------------


def test_terms_emit_trace_steps(state_db):
    parameters.seed_if_empty()
    with trace.collect() as steps:
        expr.evaluate(
            "param('csa.growth') * measure('segment_pl.revenue', 'group', 'GJAHR=2026')"
            " + calc('csa', 'pool')"
        )
    kinds = [s["step"] for s in steps]
    assert "param" in kinds
    assert "measure" in kinds
    assert "calc" in kinds
    assert "aggregate" in kinds  # the warehouse kernel's own step
    measure_step = next(s for s in steps if s["step"] == "measure")
    assert measure_step["ref"] == "segment_pl.revenue"
    assert measure_step["filters"] == "GJAHR=2026"


# --- validate() ----------------------------------------------------------------------


def test_validate_ok_returns_terms(state_db):
    parameters.seed_if_empty()
    report = expr.validate("param('csa.growth') * measure('segment_pl.revenue', 'entity')")
    assert report["ok"] is True
    assert report["errors"] == []
    kinds = {t["kind"] for t in report["terms"]}
    assert kinds == {"param", "measure"}
    assert next(t for t in report["terms"] if t["kind"] == "param")["key"] == "csa.growth"


def test_validate_collects_all_errors(state_db):
    parameters.seed_if_empty()
    report = expr.validate("param('nope') + measure('segment_pl.bogus', 'entity')")
    assert report["ok"] is False
    messages = " | ".join(e["message"] for e in report["errors"])
    assert "unknown parameter 'nope'" in messages
    assert "unknown measure 'bogus'" in messages
    assert all(e["pos"] is not None for e in report["errors"])


def test_validate_syntax_error(state_db):
    report = expr.validate("2 + * 3")
    assert report["ok"] is False
    assert report["errors"][0]["pos"] == 4
    assert report["terms"] == []


def test_validate_unknown_calc(state_db):
    parameters.seed_if_empty()
    report = expr.validate("calc('nope', 'pool')")
    assert report["ok"] is False
    assert "unknown calculation 'nope'" in report["errors"][0]["message"]


def test_extract_terms_static():
    terms = expr.extract_terms(
        "if(param('a.b') > 0, measure('segment_pl.revenue', 'entity'), calc('csa', 'pool'))"
    )
    assert [t["kind"] for t in terms] == ["param", "measure", "calc"]
    assert terms[1]["catalog_id"] == "warehouse:segment_pl"


# --- to_jsonable ---------------------------------------------------------------------


def test_to_jsonable_scalar_and_series(state_db):
    parameters.seed_if_empty()
    scalar = expr.to_jsonable(Decimal("12.50"))
    assert scalar == {"grain": "group", "value": 12.5, "value_exact": "12.50"}

    series = expr.evaluate("measure('segment_pl.revenue', 'entity', 'GJAHR=2026')")
    out = expr.to_jsonable(series)
    assert out["grain"] == "entity"
    assert len(out["rows"]) == len(series.values)
    assert {"RBUKRS", "value", "value_exact"} <= set(out["rows"][0])
    assert Decimal(out["total_exact"]) == sum(series.values.values(), Decimal(0))
