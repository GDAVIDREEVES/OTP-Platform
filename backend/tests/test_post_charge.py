"""W2 gate — governed post-charge P&L basis on the OTP-20/16/1 reads.

Covers, in order:
- the NEW governed parameter ``pl.use_post_charge`` seeds (default false,
  provenance assumed, OTP-49) and the parameter seed is REGEN-SAFE: a later
  seed key inserts into an existing store without touching edited rows;
- ``?pl=`` validation (unknown basis -> 400 on all three endpoints);
- GOLDEN NON-REGRESSION: /api/kpis, /api/margins/trend and /api/forecast are
  BYTE-IDENTICAL with the toggle off (omitted ``pl``, explicit ``pl=base``),
  with the toggle ON but no waterfall applied ("default base until a run
  exists"), and again after the toggle is reset with a run still applied;
- with the toggle ON and a waterfall APPLIED the three endpoints fold the
  overlay in: hand-checked post-charge forecast LE (entity 3000), KPI volume
  /status recompute (full year + a Jan–Jun window with the documented n/12
  annual accrual), and a hand-checked monthly margin (entity 1000, April —
  monthly service lines + 1/12 of the annual lines);
- explicit ``?pl=base`` always returns the golden bytes, applied run or not.

Run from backend/:
    ../.venv/bin/python -m pytest tests/test_post_charge.py
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

import services.post_charge as post_charge
import services.waterfall_runner as runner
import state.engine as engine
import state.parameters as parameters
import state.pl_overlays as pl_overlays
from db import q
from main import app

client = TestClient(app)

ZERO = Decimal("0")
TWELVE = Decimal("12")
YEAR = 2026
ACTOR = "pc-maker"

#: (path, params) capture set for the byte-identical golden gate.
GOLDEN_READS = (
    ("/api/kpis", {}),
    ("/api/kpis", {"year": YEAR, "periodFrom": "001", "periodTo": "006"}),
    ("/api/margins/trend", {"year": YEAR}),
    ("/api/forecast", {"year": YEAR}),
)


def _capture(extra: dict | None = None) -> dict:
    out = {}
    for path, params in GOLDEN_READS:
        out[(path, tuple(sorted(params.items())))] = client.get(
            path, params={**params, **(extra or {})}).content
    return out


def _assert_golden(pc, extra: dict | None = None) -> None:
    for key, content in _capture(extra).items():
        assert content == pc["golden"][key], f"{key} drifted with {extra}"


def _window_overlay(side: str, month_from: int, month_to: int) -> Decimal:
    """Expected overlay for one side over a month window — monthly lines in
    the window in full, annual lines at the documented n/12 accrual."""
    total = ZERO
    months = range(month_from, month_to + 1)
    n = Decimal(len(list(months)))
    for line in pl_overlays.list_lines(year=YEAR):
        if line["side"] != side:
            continue
        amount = Decimal(line["amount"])
        if "-" in line["period"]:
            if int(line["period"].split("-")[1]) in months:
                total += amount
        else:
            total += amount if n == TWELVE else amount * n / TWELVE
    return total


@pytest.fixture(scope="module")
def pc(tmp_path_factory):
    """Isolated DB: seed the parameter store, then capture the goldens
    BEFORE any toggle/waterfall mutation."""
    engine.configure(tmp_path_factory.mktemp("post_charge") / "state.db")
    engine.init_db()
    parameters.seed_if_empty()
    golden = _capture()
    base_adjusted = client.get("/api/pl/adjusted", params={"year": YEAR}).json()
    yield {"golden": golden, "base_adjusted": base_adjusted}
    engine.close()


# ------------------------------------------------------------ the parameter --


def test_pl_toggle_seeds_with_governed_default(pc):
    row = parameters.get_param_row(post_charge.PARAM_KEY)
    assert row is not None
    assert row["value"] is False and row["default"] is False
    assert row["type"] == "bool"
    assert row["category"] == "pl"
    assert row["process_id"] == "OTP-49"
    assert row["provenance"] == "assumed"


def test_parameter_seed_is_regen_safe(state_db):
    """A NEW seed key inserts into an EXISTING store; edited rows survive."""
    parameters.seed_if_empty()
    n = len(parameters.list_params())
    parameters.set_param("csa.growth", 0.5, "u_demo", rationale="edited")
    # simulate a pre-W2 store that never saw the new key
    with engine.LOCK:
        conn = engine.get_conn()
        conn.execute("DELETE FROM parameters WHERE key = ?",
                     (post_charge.PARAM_KEY,))
        conn.commit()
    assert parameters.get_param_row(post_charge.PARAM_KEY) is None
    parameters.seed_if_empty()
    row = parameters.get_param_row(post_charge.PARAM_KEY)
    assert row is not None and row["value"] is False
    assert parameters.get_param("csa.growth") == 0.5  # edit untouched
    assert len(parameters.list_params()) == n


# -------------------------------------------------------------- validation --


def test_unknown_pl_basis_is_400_everywhere(pc):
    for path in ("/api/kpis", "/api/margins/trend", "/api/forecast"):
        resp = client.get(path, params={"pl": "nope"})
        assert resp.status_code == 400, path
        assert "pl must be one of" in resp.json()["detail"]


def test_resolve_mode_unit():
    assert post_charge.resolve_mode("base") == "base"
    assert post_charge.resolve_mode("post_charge") == "post_charge"
    with pytest.raises(ValueError):
        post_charge.resolve_mode("bogus")
    with pytest.raises(ValueError):
        post_charge.parse_month("013")
    assert post_charge.parse_month(None) is None
    assert post_charge.parse_month("004") == 4


# ----------------------------------------------- golden gate: toggle off/on --


def test_toggle_off_is_byte_identical(pc):
    _assert_golden(pc)                      # omitted ?pl
    _assert_golden(pc, {"pl": "base"})      # explicit base


def test_toggle_on_without_applied_run_stays_base(pc):
    """'Default base until a waterfall run is applied': even with the toggle
    ON (or pl=post_charge forced) there is nothing to apply — byte-identical."""
    parameters.set_param(post_charge.PARAM_KEY, True, ACTOR,
                         rationale="W2 gate: enable post-charge basis")
    _assert_golden(pc)
    _assert_golden(pc, {"pl": "post_charge"})
    parameters.reset_param(post_charge.PARAM_KEY, ACTOR)
    _assert_golden(pc)


# --------------------------------------- post-charge basis with a run applied --


@pytest.fixture(scope="module")
def applied(pc):
    """Apply the full default waterfall, toggle the governed basis ON."""
    run = runner.run_waterfall(actor=ACTOR, year=YEAR)
    assert run["status"] == "applied"
    parameters.set_param(post_charge.PARAM_KEY, True, ACTOR,
                         rationale="W2 gate: enable post-charge basis")
    adjusted = client.get("/api/pl/adjusted", params={"year": YEAR}).json()
    return {"run": run, "adjusted": adjusted}


def test_forecast_post_charge_folds_fy_overlay_into_le(pc, applied):
    """Entity 3000 hand-check: post LE == base LE + the /api/pl/adjusted
    overlay (the same applied ledger), margin/verdict recomputed."""
    base = {p["rbukrs"]: p for p in client.get(
        "/api/forecast", params={"year": YEAR, "pl": "base"}).json()["parties"]}
    body = client.get("/api/forecast", params={"year": YEAR}).json()
    assert body["plBasis"] == "post_charge"
    assert body["waterfallRunId"] == applied["run"]["id"]
    overlay = {r["entity"]: r["overlay"] for r in applied["adjusted"]["rows"]}
    parties = {p["rbukrs"]: p for p in body["parties"]}

    p, b, o = parties["3000"], base["3000"], overlay["3000"]
    assert Decimal(o["revenue"]) > ZERO and Decimal(o["cost"]) > ZERO
    rev = Decimal(str(b["latestEstimate"]["revenue"])) + Decimal(o["revenue"])
    op = Decimal(str(b["latestEstimate"]["operating_profit"])) + Decimal(o["net"])
    assert p["overlay"] == {"revenue": o["revenue"], "cost": o["cost"],
                            "net": o["net"]}
    assert p["latestEstimate"]["revenue"] == pytest.approx(float(rev))
    assert p["latestEstimate"]["operating_profit"] == pytest.approx(float(op))
    assert p["fullYearMargin"] == pytest.approx(
        round(float(op / rev) * 100, 2), abs=0.01)
    # actuals + remainder stay on the base figures (FY-level application)
    assert p["actuals"] == b["actuals"]
    assert p["forecastRemainder"] == b["forecastRemainder"]
    # a party whose overlay fully nets out is untouched — no overlay key
    for rb, party in parties.items():
        if rb not in overlay or (Decimal(overlay[rb]["revenue"]) == ZERO
                                 and Decimal(overlay[rb]["cost"]) == ZERO):
            assert "overlay" not in party
            assert party["fullYearMargin"] == base[rb]["fullYearMargin"]


def test_kpis_post_charge_recomputes_volume_and_status(pc, applied):
    base = client.get("/api/kpis", params={"pl": "base"}).json()
    body = client.get("/api/kpis").json()
    assert body["plBasis"] == "post_charge"
    assert body["waterfallRunId"] == applied["run"]["id"]
    expected_rev = Decimal(applied["adjusted"]["totals"]["overlay_revenue"])
    assert body["totalICVolume"] == pytest.approx(
        base["totalICVolume"] + float(expected_rev))
    counted = (body["entitiesInRange"] + body["entitiesWatch"]
               + body["entitiesOutOfRange"] + body["entitiesNoData"])
    assert counted == body["entityCount"] == base["entityCount"]
    assert body["openAdjustments"] == body["entitiesOutOfRange"]
    # the non-P&L KPIs never change basis
    for k in ("flowsUnderAPA", "flowsChallenged"):
        assert body[k] == base[k]


def test_kpis_window_applies_documented_n_over_12_accrual(pc, applied):
    """Jan–Jun window: monthly lines in 04/05 count in full, annual lines at
    6/12 — the documented straight-line convention."""
    params = {"year": YEAR, "periodFrom": "001", "periodTo": "006"}
    base = client.get("/api/kpis", params={**params, "pl": "base"}).json()
    body = client.get("/api/kpis", params=params).json()
    expected = _window_overlay("revenue", 1, 6)
    assert expected > ZERO
    assert body["totalICVolume"] == pytest.approx(
        base["totalICVolume"] + float(expected))
    assert client.get("/api/kpis", params={**params, "periodFrom": "abc"}
                      ).status_code == 400  # garbage month, post-charge basis


def test_margins_trend_post_charge_hand_checked_cell(pc, applied):
    """Entity 1000, April: + the 2026-04 monthly service lines (in full) and
    1/12 of each annual line; margin recomputes from segment_pl April."""
    row = q("SELECT revenue, operating_profit FROM segment_pl "
            "WHERE GJAHR = ? AND POPER = '004' AND RBUKRS = '1000'", [YEAR])[0]
    rev_adj = ZERO
    net_adj = ZERO
    for line in pl_overlays.list_lines(year=YEAR, entity="1000"):
        amount = Decimal(line["amount"])
        if "-" in line["period"]:
            share = amount if line["period"] == f"{YEAR}-04" else ZERO
        else:
            share = amount / TWELVE
        if line["side"] == "revenue":
            rev_adj += share
            net_adj += share
        else:
            net_adj -= share
    assert rev_adj > ZERO
    rev = Decimal(str(row["revenue"])) + rev_adj
    op = Decimal(str(row["operating_profit"])) + net_adj
    expected = round(float(op / rev) * 100, 2)

    trend = client.get("/api/margins/trend", params={"year": YEAR}).json()
    april = next(r for r in trend if r["month"] == "Apr")
    assert april["1000"] == pytest.approx(expected, abs=0.005)
    # and the post-charge April cell really differs from the base golden
    base_trend = client.get("/api/margins/trend",
                            params={"year": YEAR, "pl": "base"}).json()
    base_april = next(r for r in base_trend if r["month"] == "Apr")
    assert april["1000"] != base_april["1000"]
    assert len(trend) == 12 and all("month" in r for r in trend)


def test_explicit_base_is_golden_even_with_run_applied(pc, applied):
    _assert_golden(pc, {"pl": "base"})


def test_toggle_off_restores_golden_with_run_still_applied(pc, applied):
    parameters.reset_param(post_charge.PARAM_KEY, ACTOR)
    _assert_golden(pc)
    # ...and an explicit ?pl=post_charge still opts in per-request
    body = client.get("/api/forecast", params={"year": YEAR,
                                               "pl": "post_charge"}).json()
    assert body.get("plBasis") == "post_charge"
