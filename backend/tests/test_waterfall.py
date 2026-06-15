"""W1 gate — P&L overlay store + waterfall orchestrator + adjusted P&L API.

Covers, in order:
- the full default run (service_allocation -> royalties -> csa_true_up ->
  profit_split) applies, with per-step summaries;
- CENT-EXACT tie-outs: service_charge overlays == the warehouse SERVICE pair
  ledger (FY gross 14,344,773.26), royalty overlays == the ROYALTY pair
  ledger (2,312,791.90), csa_true_up / profit_split overlays == the calc
  outputs' true_up columns;
- the group nets to ZERO — overall and per step (double-entry by
  construction);
- /api/pl/adjusted post-charge margins recompute correctly for hand-checked
  entities (3000 recipient-heavy, 1000 provider-heavy), at both grains;
- rollback writes one reversing row per line (append-only), restores
  post == base exactly, and refuses a second rollback;
- re-running supersedes the prior applied run (never double-counts);
- audit trail: waterfall:{run} + overlay:{line} events, chain verifies;
- GOLDEN NON-REGRESSION: /api/segments/pl and /api/margins/trend are
  byte-identical before/after every waterfall mutation (no waterfall is ever
  applied to those endpoints).

NO float arithmetic on overlay amounts anywhere in this file.

Run from backend/:
    ../.venv/bin/python -m pytest tests/test_waterfall.py
"""

from __future__ import annotations

from decimal import Decimal

import duckdb
import pytest
from fastapi.testclient import TestClient

import services.waterfall_runner as runner
import state.audit as audit
import state.engine as engine
import state.pl_overlays as pl_overlays
from config import SEGMENT_PL, SUPPLY_CHAIN
from main import app
from routers.csa import csa, profit_split

client = TestClient(app)

ZERO = Decimal("0")
CENT = Decimal("0.01")
YEAR = 2026
DEFAULT_STEPS = ["service_allocation", "royalties", "csa_true_up",
                 "profit_split"]

GOLDEN_ENDPOINTS = ("/api/segments/pl", "/api/margins/trend")


def _warehouse_pairs(material_type: str) -> dict[tuple[str, str], Decimal]:
    """FY (seller, buyer) -> Σ TOTAL_LEGAL_PRICE — Decimal end to end."""
    con = duckdb.connect()
    rows = con.execute(
        f"""
        SELECT SELLING_COMPANY, BUYING_COMPANY, SUM(TOTAL_LEGAL_PRICE)
        FROM read_parquet('{SUPPLY_CHAIN}')
        WHERE MATERIAL_TYPE = ? AND GJAHR = ?
        GROUP BY 1, 2
        """,
        [material_type, YEAR],
    ).fetchall()
    con.close()
    out = {}
    for seller, buyer, total in rows:
        assert isinstance(total, Decimal)
        out[(seller, buyer)] = total
    return out


def _base_entity(entity: str) -> tuple[Decimal, Decimal]:
    """FY (revenue, operating_profit) for one entity off the parquet."""
    con = duckdb.connect()
    revenue, op = con.execute(
        f"""
        SELECT SUM(revenue), SUM(operating_profit)
        FROM read_parquet('{SEGMENT_PL}') WHERE GJAHR = ? AND RBUKRS = ?
        """,
        [YEAR, entity],
    ).fetchone()
    con.close()
    assert isinstance(revenue, Decimal) and isinstance(op, Decimal)
    return revenue, op


def _sum_lines(lines, *, kind=None, side=None, entity=None) -> Decimal:
    total = ZERO
    for l in lines:
        if kind is not None and l["line_kind"] != kind:
            continue
        if side is not None and l["side"] != side:
            continue
        if entity is not None and l["entity"] != entity:
            continue
        total += Decimal(l["amount"])
    return total


@pytest.fixture(scope="module")
def wf(tmp_path_factory):
    """One isolated DB: capture the goldens, then apply the full waterfall."""
    engine.configure(tmp_path_factory.mktemp("waterfall") / "state.db")
    engine.init_db()
    golden = {ep: client.get(ep).content for ep in GOLDEN_ENDPOINTS}
    base_adjusted = client.get("/api/pl/adjusted",
                               params={"year": YEAR}).json()
    run = runner.run_waterfall(actor="wf-maker", year=YEAR)
    yield {"run": run, "golden": golden, "base_adjusted": base_adjusted}
    engine.close()


# ----------------------------------------------------------------- the run --


def test_default_run_applies_all_four_steps_in_order(wf):
    run = wf["run"]
    assert run["status"] == "applied"
    assert run["year"] == YEAR
    assert [s["id"] for s in run["steps"]] == DEFAULT_STEPS
    for step in run["steps"]:
        assert step["status"] == "applied"
        assert step["lines"] > 0
        # per-step double entry: revenue total == cost total, net "0"-ish
        assert Decimal(step["revenue_total"]) == Decimal(step["cost_total"])
        assert Decimal(step["net"]) == ZERO
    svc = run["steps"][0]
    assert svc["billing_periods"] == ["2026-04", "2026-05", "2026-10",
                                      "2026-11"]
    assert len(svc["allocation_run_ids"]) == 4


def test_adjusted_base_equals_segment_pl_before_any_run(wf):
    """Before any waterfall: every post_charge column equals base and the
    overlay is empty (default-base behavior, no silent application)."""
    body = wf["base_adjusted"]
    assert body["applied_run_id"] is None
    assert body["rows"]
    for row in body["rows"]:
        assert row["lines"] == []
        assert row["overlay"]["net"] == "0"
        assert row["post_charge"]["revenue"] == row["base"]["revenue"]
        assert (row["post_charge"]["operating_profit"]
                == row["base"]["operating_profit"])


# ---------------------------------------------------- cent-exact tie-outs --


def test_service_charge_overlays_tie_to_warehouse_service_pairs(wf):
    """Σ provider revenue+ / recipient cost+ per entity == the SERVICE pair
    ledger (the same totals the allocation engine ties to), to the cent."""
    pairs = _warehouse_pairs("SERVICE")
    lines = pl_overlays.list_lines(waterfall_run_id=wf["run"]["id"])
    by_provider: dict[str, Decimal] = {}
    by_recipient: dict[str, Decimal] = {}
    for (provider, recipient), gross in pairs.items():
        by_provider[provider] = by_provider.get(provider, ZERO) + gross
        by_recipient[recipient] = by_recipient.get(recipient, ZERO) + gross
    for provider, expected in by_provider.items():
        assert _sum_lines(lines, kind="service_charge", side="revenue",
                          entity=provider) == expected
    for recipient, expected in by_recipient.items():
        assert _sum_lines(lines, kind="service_charge", side="cost",
                          entity=recipient) == expected
    total = Decimal("14344773.26")
    assert _sum_lines(lines, kind="service_charge", side="revenue") == total
    assert _sum_lines(lines, kind="service_charge", side="cost") == total
    # every line drills back to a persisted allocation charge
    assert all(l["source_ref"].startswith("charge:RUN-")
               for l in lines if l["line_kind"] == "service_charge")


def test_royalty_overlays_tie_to_warehouse_royalty_pairs(wf):
    pairs = _warehouse_pairs("ROYALTY")
    assert sum(pairs.values(), ZERO) == Decimal("2312791.90")
    lines = pl_overlays.list_lines(waterfall_run_id=wf["run"]["id"])
    for (licensor, licensee), fees in pairs.items():
        ref = f"royalty:{YEAR}:{licensor}->{licensee}"
        pair_lines = [l for l in lines if l["source_ref"] == ref]
        assert {(l["entity"], l["side"]) for l in pair_lines} \
            == {(licensor, "revenue"), (licensee, "cost")}
        assert all(Decimal(l["amount"]) == fees for l in pair_lines)
    total = Decimal("2312791.90")
    assert _sum_lines(lines, kind="royalty", side="revenue") == total
    assert _sum_lines(lines, kind="royalty", side="cost") == total


def test_csa_and_profit_split_overlays_tie_to_calc_outputs(wf):
    """Each participant's overlay line == its calc true_up to the cent —
    CSA: positive pays in (cost+); profit split: positive is owed (revenue+)."""
    lines = pl_overlays.list_lines(waterfall_run_id=wf["run"]["id"])
    for p in csa(year=YEAR)["participants"]:
        t = Decimal(str(p["true_up"])).quantize(CENT)
        side = "cost" if t > ZERO else "revenue"
        assert _sum_lines(lines, kind="csa_true_up", side=side,
                          entity=p["rbukrs"]) == abs(t)
    for p in profit_split(year=YEAR)["participants"]:
        t = Decimal(str(p["true_up"])).quantize(CENT)
        side = "revenue" if t > ZERO else "cost"
        assert _sum_lines(lines, kind="profit_split", side=side,
                          entity=p["rbukrs"]) == abs(t)


def test_group_nets_to_zero_overall_and_per_step(wf):
    lines = pl_overlays.list_lines(waterfall_run_id=wf["run"]["id"])
    assert (_sum_lines(lines, side="revenue")
            - _sum_lines(lines, side="cost")) == ZERO
    for kind in ("service_charge", "royalty", "csa_true_up", "profit_split"):
        assert (_sum_lines(lines, kind=kind, side="revenue")
                - _sum_lines(lines, kind=kind, side="cost")) == ZERO


# ------------------------------------------------------------ adjusted P&L --


def test_post_charge_margins_recompute_for_hand_checked_entities(wf):
    """Entity 3000 (recipient of the IT service + a royalty, owed residual
    profit) and entity 1000 (provider) — expected values built independently
    from the source ledgers, Decimal end to end."""
    service = _warehouse_pairs("SERVICE")
    royalty = _warehouse_pairs("ROYALTY")
    ps = {p["rbukrs"]: Decimal(str(p["true_up"])).quantize(CENT)
          for p in profit_split(year=YEAR)["participants"]}
    cs = {p["rbukrs"]: Decimal(str(p["true_up"])).quantize(CENT)
          for p in csa(year=YEAR)["participants"]}

    body = client.get("/api/pl/adjusted", params={"year": YEAR}).json()
    assert body["applied_run_id"] == wf["run"]["id"]
    rows = {r["entity"]: r for r in body["rows"]}

    # ---- 3000: cost+ = service 1000->3000 + royalty 1000->3000;
    #      revenue+ = its (positive) residual profit-split true-up ----------
    base_rev, base_op = _base_entity("3000")
    rev_3000 = ps["3000"]  # 27,134,976.00 owed residual profit
    assert rev_3000 > ZERO and "3000" not in cs
    cost_3000 = service[("1000", "3000")] + royalty[("1000", "3000")]
    row = rows["3000"]
    assert Decimal(row["overlay"]["revenue"]) == rev_3000
    assert Decimal(row["overlay"]["cost"]) == cost_3000
    expected_op = base_op + rev_3000 - cost_3000
    expected_rev = base_rev + rev_3000
    assert Decimal(str(row["post_charge"]["operating_profit"])) == expected_op
    assert Decimal(str(row["post_charge"]["revenue"])) == expected_rev
    assert row["post_charge"]["operating_margin"] \
        == pytest.approx(float(expected_op / expected_rev))
    assert row["base"]["operating_margin"] \
        == pytest.approx(float(base_op / base_rev))

    # ---- 1000: revenue+ = service + royalty out to 3000;
    #      cost+ = CSA pay-in + residual paid away --------------------------
    base_rev, base_op = _base_entity("1000")
    rev_1000 = service[("1000", "3000")] + royalty[("1000", "3000")]
    cost_1000 = cs["1000"] + (-ps["1000"])  # both positive pay-aways
    assert cs["1000"] > ZERO and ps["1000"] < ZERO
    row = rows["1000"]
    assert Decimal(row["overlay"]["revenue"]) == rev_1000
    assert Decimal(row["overlay"]["cost"]) == cost_1000
    expected_op = base_op + rev_1000 - cost_1000
    assert Decimal(str(row["post_charge"]["operating_profit"])) == expected_op
    # per-kind provenance on the row
    by_kind = row["overlay"]["by_kind"]
    assert Decimal(by_kind["csa_true_up"]["cost"]) == cs["1000"]
    assert Decimal(by_kind["profit_split"]["cost"]) == -ps["1000"]
    assert all({"step", "source_ref", "waterfall_run_id"} <= set(l)
               for l in row["lines"])


def test_adjusted_entity_function_grain_matches_entity_grain(wf):
    """Each demo entity has exactly one function, so the entity_function
    rows carry the ROLE_CODE and reproduce the entity-grain post figures."""
    by_entity = {r["entity"]: r for r in client.get(
        "/api/pl/adjusted", params={"year": YEAR}).json()["rows"]}
    body = client.get("/api/pl/adjusted",
                      params={"year": YEAR, "grain": "entity_function"}).json()
    assert body["grain"] == "entity_function"
    for row in body["rows"]:
        assert row["function"]  # ROLE_CODE present
        peer = by_entity[row["entity"]]
        assert row["overlay"]["net"] == peer["overlay"]["net"]
        assert (row["post_charge"]["operating_profit"]
                == peer["post_charge"]["operating_profit"])
        for line in row["lines"]:
            assert line["function"] == row["function"]
    assert client.get("/api/pl/adjusted",
                      params={"grain": "nope"}).status_code == 400


# ------------------------------------------------------------------- audit --


def test_run_and_lines_are_audited_and_chain_verifies(wf):
    run_events = audit.list_events(record_ref=f"waterfall:{wf['run']['id']}")
    assert [e["event_type"] for e in run_events] == ["run"]
    assert run_events[0]["after"]["status"] == "applied"
    line = pl_overlays.list_lines(waterfall_run_id=wf["run"]["id"])[0]
    line_events = audit.list_events(record_ref=f"overlay:{line['id']}")
    assert [e["event_type"] for e in line_events] == ["posted"]
    assert line_events[0]["process_id"] == "OTP-21"
    assert audit.verify_chain() == {"ok": True, "broken_at": None}


# -------------------------------------------------------- API + validation --


def test_api_run_listing_and_detail(wf):
    listed = client.get("/api/waterfall/runs").json()
    assert any(r["id"] == wf["run"]["id"] for r in listed)
    detail = client.get(f"/api/waterfall/runs/{wf['run']['id']}").json()
    assert detail["status"] == "applied"
    assert len(detail["lines"]) == sum(s["lines"] for s in detail["steps"])
    assert client.get("/api/waterfall/runs/WF-NOPE").status_code == 404


def test_api_rejects_malformed_launches(wf):
    assert client.post("/api/waterfall/runs",
                       json={"actor": "t", "steps": ["nope"]}
                       ).status_code == 400
    assert client.post("/api/waterfall/runs",
                       json={"actor": "t",
                             "steps": ["royalties", "royalties"]}
                       ).status_code == 400
    assert client.post("/api/waterfall/runs/WF-NOPE/rollback",
                       json={"actor": "t"}).status_code == 404


# ---------------------------------------------------------------- rollback --


def test_rollback_reverses_every_line_exactly_and_restores_base(wf):
    run_id = wf["run"]["id"]
    originals = pl_overlays.list_lines(waterfall_run_id=run_id)
    resp = client.post(f"/api/waterfall/runs/{run_id}/rollback",
                       json={"actor": "wf-checker"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "rolled_back"
    assert body["reversed_lines"] == len(originals)

    after = pl_overlays.list_lines(waterfall_run_id=run_id)
    assert len(after) == 2 * len(originals)
    reversals = {l["reverses_id"]: l for l in after if l["reverses_id"]}
    assert len(reversals) == len(originals)  # exactly one reversal per line
    for orig in originals:
        rev = reversals[orig["id"]]
        assert Decimal(rev["amount"]) == -Decimal(orig["amount"])
        for field in ("entity", "function", "period", "line_kind", "side",
                      "source_ref", "step", "waterfall_run_id"):
            assert rev[field] == orig[field]
        events = audit.list_events(record_ref=f"overlay:{rev['id']}")
        assert [e["event_type"] for e in events] == ["reversed"]

    # adjusted P&L is back to base, exactly
    adjusted = client.get("/api/pl/adjusted", params={"year": YEAR}).json()
    assert adjusted["applied_run_id"] is None
    assert Decimal(adjusted["totals"]["overlay_net"]) == ZERO
    for row in adjusted["rows"]:
        assert Decimal(row["overlay"]["net"]) == ZERO
        assert (row["post_charge"]["operating_profit"]
                == row["base"]["operating_profit"])
        assert row["post_charge"]["revenue"] == row["base"]["revenue"]

    # a second rollback must refuse — only an applied run can roll back
    assert client.post(f"/api/waterfall/runs/{run_id}/rollback",
                       json={"actor": "wf-checker"}).status_code == 400


def test_rerun_supersedes_prior_applied_run_never_double_counting(wf):
    """Apply wf2, then wf3: wf2 is auto-superseded (its lines reversed), so
    the ledger still nets to exactly ONE application of every charge."""
    run2 = client.post("/api/waterfall/runs",
                       json={"actor": "wf-maker", "year": YEAR}).json()
    assert run2["status"] == "applied"
    run3 = client.post("/api/waterfall/runs",
                       json={"actor": "wf-maker", "year": YEAR}).json()
    assert run3["status"] == "applied"
    assert pl_overlays.get_run(run2["id"])["status"] == "superseded"

    all_lines = pl_overlays.list_lines(year=YEAR)
    assert _sum_lines(all_lines, kind="service_charge", side="revenue") \
        == Decimal("14344773.26")  # applied exactly once, not 3x
    assert (_sum_lines(all_lines, side="revenue")
            - _sum_lines(all_lines, side="cost")) == ZERO
    assert client.get("/api/pl/adjusted", params={"year": YEAR}).json()[
        "applied_run_id"] == run3["id"]


def test_custom_step_subset_applies_only_those_steps(wf):
    run = client.post("/api/waterfall/runs",
                      json={"actor": "wf-maker", "year": YEAR,
                            "steps": ["royalties"]}).json()
    assert run["status"] == "applied"
    assert [s["id"] for s in run["steps"]] == ["royalties"]
    lines = pl_overlays.list_lines(waterfall_run_id=run["id"])
    assert {l["line_kind"] for l in lines} == {"royalty"}
    # the full run before it was superseded; only royalties remain applied
    body = client.get("/api/pl/adjusted", params={"year": YEAR}).json()
    totals = {k: Decimal(v) for k, v in body["totals"].items()}
    assert totals["overlay_revenue"] == Decimal("2312791.90")
    assert totals["overlay_net"] == ZERO


# ------------------------------------------------- golden non-regression --


def test_existing_endpoints_byte_identical_after_all_mutations(wf):
    """/api/segments/pl and /api/margins/trend never read the overlay
    ledger: byte-identical to their pre-waterfall captures even after runs,
    a rollback, supersedes and a custom run."""
    for ep, before in wf["golden"].items():
        assert client.get(ep).content == before


# ------------------------------------------------ state-module unit tests --


def test_append_lines_validation_rejects_bad_lines(state_db):
    def line(**over):
        base = {"entity": "1000", "function": "IPPR", "period": "2026",
                "line_kind": "other", "side": "cost", "amount": "10.00",
                "source_ref": "test:1"}
        return {**base, **over}

    def must_fail(bad, match):
        with pytest.raises(ValueError, match=match):
            pl_overlays.append_lines([bad], waterfall_run_id="WF-X",
                                     step="t", actor="t")

    must_fail(line(line_kind="bogus"), "invalid line_kind")
    must_fail(line(side="middle"), "invalid side")
    must_fail(line(amount="-1"), "reversing rows")
    must_fail(line(amount="ten"), "not a decimal")
    must_fail(line(source_ref=""), "missing 'source_ref'")
    must_fail(line(entity=None), "missing 'entity'")
    assert pl_overlays.list_lines() == []  # nothing persisted
    assert pl_overlays.append_lines([], waterfall_run_id="WF-X",
                                    step="t", actor="t") == []


def test_run_table_enforces_legal_transitions(state_db):
    run = pl_overlays.insert_run(year=2026, steps=["royalties"], actor="t")
    assert run["status"] == "running"
    assert run["steps"] == [{"id": "royalties", "status": "pending"}]
    with pytest.raises(ValueError, match="illegal waterfall run transition"):
        pl_overlays.set_run_status(run["id"], "rolled_back")
    done = pl_overlays.finish_run(run["id"], status="applied",
                                  steps=[{"id": "royalties", "lines": 0}])
    assert done["status"] == "applied"
    with pytest.raises(ValueError, match="illegal waterfall run transition"):
        pl_overlays.finish_run(run["id"], status="failed")
    rolled = pl_overlays.set_run_status(run["id"], "rolled_back")
    assert rolled["status"] == "rolled_back"
    with pytest.raises(ValueError, match="unknown waterfall run"):
        pl_overlays.finish_run("WF-NOPE", status="applied")
