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
import state.review as review
import state.waterfall_requests as waterfall_requests
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


# -------------------------------------------- GP4 request→approve helpers --


def _pending_waterfall_item(record_ref: str) -> dict | None:
    """The pending review item sitting at ``record_ref`` (newest wins)."""
    items = client.get("/api/review-queue", params={"status": "pending"}).json()
    matches = [it for it in items if it["record_ref"] == record_ref]
    return matches[-1] if matches else None


def _approve_run_request(
    *, year=YEAR, steps=None, maker="wf-maker", checker="wf-checker",
) -> dict:
    """Submit a run request and approve it as a DIFFERENT persona; return the
    (now approved) request row — its ``executed_run_id`` names the WF-* run."""
    payload = {"actor": maker, "action": "run", "year": year}
    if steps is not None:
        payload["steps"] = steps
    req = client.post("/api/waterfall/requests", json=payload).json()
    item = _pending_waterfall_item(req["record_ref"])
    resp = client.post(f"/api/review/{item['id']}/approve", json={"checker": checker})
    assert resp.status_code == 200, resp.text
    return waterfall_requests.get_request(req["id"])


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


def test_request_endpoint_rejects_malformed(wf):
    """Malformed requests are refused at submission — a doomed request never
    reaches the review queue (GP4)."""
    # unknown / duplicate steps
    assert client.post("/api/waterfall/requests",
                       json={"actor": "t", "action": "run", "steps": ["nope"]}
                       ).status_code == 400
    assert client.post("/api/waterfall/requests",
                       json={"actor": "t", "action": "run",
                             "steps": ["royalties", "royalties"]}
                       ).status_code == 400
    # bad action
    assert client.post("/api/waterfall/requests",
                       json={"actor": "t", "action": "nope"}).status_code == 400
    # rollback needs a target, and an unknown target is a 404
    assert client.post("/api/waterfall/requests",
                       json={"actor": "t", "action": "rollback"}).status_code == 400
    assert client.post("/api/waterfall/requests",
                       json={"actor": "t", "action": "rollback",
                             "target_run_id": "WF-NOPE"}).status_code == 404
    # none of these enqueued anything
    assert not [it for it in client.get("/api/review-queue").json()
                if it["record_ref"].startswith("waterfall:")]


# ---------------------------------------------------------------- rollback --


def test_rollback_via_request_reverses_every_line_and_restores_base(wf):
    run_id = wf["run"]["id"]
    originals = pl_overlays.list_lines(waterfall_run_id=run_id)
    # rollback now goes through the gate: request → approve as a DIFFERENT persona
    req = client.post("/api/waterfall/requests",
                      json={"actor": "wf-maker", "action": "rollback",
                            "target_run_id": run_id}).json()
    # still applied while the rollback awaits approval — P&L untouched
    assert pl_overlays.get_run(run_id)["status"] == "applied"
    item = _pending_waterfall_item(req["record_ref"])
    resp = client.post(f"/api/review/{item['id']}/approve",
                       json={"checker": "wf-checker"})
    assert resp.status_code == 200
    approved = waterfall_requests.get_request(req["id"])
    assert approved["status"] == "approved"
    assert approved["executed_run_id"] == run_id
    assert pl_overlays.get_run(run_id)["status"] == "rolled_back"

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

    # a second rollback request must refuse at submission — only an applied run
    # can roll back (the target is now rolled_back)
    assert client.post("/api/waterfall/requests",
                       json={"actor": "wf-maker", "action": "rollback",
                             "target_run_id": run_id}).status_code == 400


def test_rerun_via_requests_supersedes_prior_applied_run(wf):
    """Apply wf2, then wf3 (each through request→approve): wf2 is auto-
    superseded (its lines reversed), so the ledger still nets to exactly ONE
    application of every charge."""
    r2 = _approve_run_request()
    r3 = _approve_run_request()
    run2, run3 = r2["executed_run_id"], r3["executed_run_id"]
    assert pl_overlays.get_run(run2)["status"] == "superseded"
    assert pl_overlays.get_run(run3)["status"] == "applied"

    all_lines = pl_overlays.list_lines(year=YEAR)
    assert _sum_lines(all_lines, kind="service_charge", side="revenue") \
        == Decimal("14344773.26")  # applied exactly once, not 3x
    assert (_sum_lines(all_lines, side="revenue")
            - _sum_lines(all_lines, side="cost")) == ZERO
    assert client.get("/api/pl/adjusted", params={"year": YEAR}).json()[
        "applied_run_id"] == run3


def test_custom_step_subset_via_request_applies_only_those_steps(wf):
    r = _approve_run_request(steps=["royalties"])
    run = pl_overlays.get_run(r["executed_run_id"])
    assert run["status"] == "applied"
    assert [s["id"] for s in run["steps"]] == ["royalties"]
    lines = pl_overlays.list_lines(waterfall_run_id=r["executed_run_id"])
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


# --------------------------- GP4 request→approve lifecycle (isolated DB) --
#
# The waterfall rewrites the group P&L, so it must never execute on a single
# click: a run/rollback is a REQUEST that a DIFFERENT reviewer approves. These
# tests run on a fresh DB (state_db) and use the cheap royalties-only subset so
# the request→approve→execute lifecycle is exercised without the allocation
# engine (the full sequence is covered by the wf fixture + migrated tests).


def test_run_request_leaves_pl_untouched_until_approved(state_db):
    """The core control: a run request is PENDING and the group P&L is NOT
    changed; only a DIFFERENT reviewer's approval executes it."""
    # baseline: no overlay anywhere, post-charge == base
    assert pl_overlays.list_lines() == []
    assert pl_overlays.list_runs() == []
    before = client.get("/api/pl/adjusted", params={"year": YEAR}).json()
    assert before["applied_run_id"] is None

    req = client.post("/api/waterfall/requests",
                      json={"actor": "op", "action": "run", "year": YEAR,
                            "steps": ["royalties"],
                            "rationale": "close FY26"}).json()
    assert req["status"] == "pending"
    assert req["record_ref"] == f"waterfall:{req['id']}"

    # P&L is UNTOUCHED — the request executed nothing
    assert pl_overlays.list_lines() == []
    assert pl_overlays.list_runs() == []
    assert client.get("/api/pl/adjusted", params={"year": YEAR}).json()[
        "applied_run_id"] is None
    # one pending maker-checker item sits at the waterfall ref, owned by OTP-21
    item = _pending_waterfall_item(req["record_ref"])
    assert item is not None
    assert item["process_id"] == "OTP-21" and item["maker"] == "op"

    # approve as a DIFFERENT persona → the run executes NOW
    resp = client.post(f"/api/review/{item['id']}/approve",
                       json={"checker": "rev"})
    assert resp.status_code == 200
    approved = waterfall_requests.get_request(req["id"])
    assert approved["status"] == "approved"
    run_id = approved["executed_run_id"]
    assert pl_overlays.get_run(run_id)["status"] == "applied"

    # overlay applied, group nets to ZERO, adjusted reflects it
    lines = pl_overlays.list_lines(waterfall_run_id=run_id)
    assert lines
    assert (_sum_lines(lines, side="revenue")
            - _sum_lines(lines, side="cost")) == ZERO
    body = client.get("/api/pl/adjusted", params={"year": YEAR}).json()
    assert body["applied_run_id"] == run_id
    assert Decimal(body["totals"]["overlay_net"]) == ZERO

    # the executed run's OWN audit landed (waterfall:{run} + overlay:{line}),
    # and the request ref carries submitted → approved → posted; chain verifies
    assert [e["event_type"] for e in
            audit.list_events(record_ref=f"waterfall:{run_id}")] == ["run"]
    assert [e["event_type"] for e in
            audit.list_events(record_ref=f"overlay:{lines[0]['id']}")] == ["posted"]
    assert [e["event_type"] for e in
            audit.list_events(record_ref=req["record_ref"])] \
        == ["submitted", "approved", "posted", "handoff"]
    assert audit.verify_chain() == {"ok": True, "broken_at": None}


def test_rejected_run_request_never_runs_and_pl_untouched(state_db):
    req = client.post("/api/waterfall/requests",
                      json={"actor": "op", "action": "run", "year": YEAR,
                            "steps": ["royalties"]}).json()
    item = _pending_waterfall_item(req["record_ref"])
    resp = client.post(f"/api/review/{item['id']}/reject",
                       json={"checker": "rev", "comments": "not this period"})
    assert resp.status_code == 200
    # NOTHING ran — the group P&L is exactly as it was
    assert pl_overlays.list_runs() == []
    assert pl_overlays.list_lines() == []
    assert client.get("/api/pl/adjusted", params={"year": YEAR}).json()[
        "applied_run_id"] is None
    assert waterfall_requests.get_request(req["id"])["status"] == "rejected"


def test_self_approve_of_waterfall_request_is_blocked(state_db):
    """Maker ≠ checker is enforced in decide(): a self-approve is a 409 and
    executes nothing."""
    req = client.post("/api/waterfall/requests",
                      json={"actor": "solo", "action": "run", "year": YEAR,
                            "steps": ["royalties"]}).json()
    item = _pending_waterfall_item(req["record_ref"])
    resp = client.post(f"/api/review/{item['id']}/approve",
                       json={"checker": "solo"})
    assert resp.status_code == 409
    assert pl_overlays.list_runs() == []
    assert pl_overlays.list_lines() == []
    assert waterfall_requests.get_request(req["id"])["status"] == "pending"


def test_rollback_request_reverses_prior_applied_run_on_approval(state_db):
    # apply a run through the gate first
    r = _approve_run_request(steps=["royalties"], maker="op", checker="rev")
    run_id = r["executed_run_id"]
    assert pl_overlays.get_run(run_id)["status"] == "applied"

    # request a rollback; it stays PENDING and the run stays applied
    rb = client.post("/api/waterfall/requests",
                     json={"actor": "op", "action": "rollback",
                           "target_run_id": run_id}).json()
    assert pl_overlays.get_run(run_id)["status"] == "applied"
    item = _pending_waterfall_item(rb["record_ref"])
    client.post(f"/api/review/{item['id']}/approve", json={"checker": "rev"})

    # approval reversed it — back to base
    assert pl_overlays.get_run(run_id)["status"] == "rolled_back"
    assert client.get("/api/pl/adjusted", params={"year": YEAR}).json()[
        "applied_run_id"] is None
    assert waterfall_requests.get_request(rb["id"])["executed_run_id"] == run_id


def test_decide_hook_is_noop_for_missing_request_id(state_db):
    """A waterfall:{id} review item with no backing request → decide() is a
    defensive no-op: the decision lands, nothing executes, nothing crashes."""
    review.create_item(process_id="OTP-21",
                       record_ref="waterfall:WFR-nope", maker="op")
    item = _pending_waterfall_item("waterfall:WFR-nope")
    resp = client.post(f"/api/review/{item['id']}/approve",
                       json={"checker": "rev"})
    assert resp.status_code == 200
    assert pl_overlays.list_runs() == []
    assert pl_overlays.list_lines() == []


def test_stale_rollback_target_is_voided_not_stranded(state_db):
    """TOCTOU regression: request rollback of an applied run, then supersede it
    with a NEW approved run, then approve the now-stale rollback. The rollback
    must resolve TERMINALLY (auto-voided) — not strand pending with its review
    item consumed — and must never 500/double-touch the P&L."""
    # apply run1 through the gate
    r1 = _approve_run_request(steps=["royalties"], maker="op", checker="rev")
    run1 = r1["executed_run_id"]
    assert pl_overlays.get_run(run1)["status"] == "applied"

    # request a rollback of run1 (still applied) — stays pending
    rb = client.post("/api/waterfall/requests",
                     json={"actor": "op", "action": "rollback",
                           "target_run_id": run1}).json()
    rb_item = _pending_waterfall_item(rb["record_ref"])

    # meanwhile a NEW run is approved → run1 is superseded, run2 is applied
    r2 = _approve_run_request(steps=["royalties"], maker="op", checker="rev")
    run2 = r2["executed_run_id"]
    assert pl_overlays.get_run(run1)["status"] == "superseded"
    assert pl_overlays.get_run(run2)["status"] == "applied"

    # approving the STALE rollback must NOT raise/strand — request is voided
    resp = client.post(f"/api/review/{rb_item['id']}/approve",
                       json={"checker": "rev"})
    assert resp.status_code == 200
    voided = waterfall_requests.get_request(rb["id"])
    assert voided["status"] == "rejected"           # terminal, not pending
    assert voided["executed_run_id"] is None        # nothing ran

    # the P&L reflects the NEW run only — run1 stays superseded, not re-touched
    assert pl_overlays.get_run(run1)["status"] == "superseded"
    assert pl_overlays.get_run(run2)["status"] == "applied"
    body = client.get("/api/pl/adjusted", params={"year": YEAR}).json()
    assert body["applied_run_id"] == run2
    assert Decimal(body["totals"]["overlay_net"]) == ZERO

    # audit reads submitted → approved → rejected(void); chain verifies; and no
    # pending item lingers for the voided request
    events = [e["event_type"]
              for e in audit.list_events(record_ref=rb["record_ref"])]
    assert events == ["submitted", "approved", "rejected"]
    assert audit.verify_chain() == {"ok": True, "broken_at": None}
    assert _pending_waterfall_item(rb["record_ref"]) is None
