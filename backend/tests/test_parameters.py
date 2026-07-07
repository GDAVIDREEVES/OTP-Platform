"""TDD for the governed parameter store (state/parameters.py + routers/parameters.py).

The store is seeded with the EXACT current hardcoded calc constants, so migrating
the routers to read get_param leaves every API response byte-identical. These
tests cover: the seed loads (including the list and dict parameters), get_param
returns parsed values, set_param/reset_param update + hash-chain at param:{key},
and GET /api/csa shares are unchanged.

Run from `backend/`:  python -m pytest tests/test_parameters.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

import state.audit as audit
import state.parameters as parameters
from main import app

client = TestClient(app)


def test_seed_populates(state_db):
    parameters.seed_if_empty()
    rows = parameters.list_params()
    keys = {p["key"] for p in rows}
    assert "csa.growth" in keys
    assert "beat.racct_type" in keys
    assert "reconciliation.value_break_tolerance" in keys


def test_seed_is_idempotent(state_db):
    parameters.seed_if_empty()
    n1 = len(parameters.list_params())
    parameters.seed_if_empty()
    assert len(parameters.list_params()) == n1


def test_get_param_returns_parsed_scalars(state_db):
    parameters.seed_if_empty()
    assert parameters.get_param("csa.growth") == 0.08
    assert parameters.get_param("csa.pct_mult") == 3
    assert parameters.get_param("beat.threshold_pct") == 3.0
    assert parameters.get_param("beat.rate_pct") == 10.0
    assert parameters.get_param("beat.us_payer") == "1000"
    assert parameters.get_param("reconciliation.value_break_tolerance") == 1.0


def test_get_param_returns_parsed_list(state_db):
    parameters.seed_if_empty()
    participants = parameters.get_param("csa.ps_participants")
    assert participants == ["1000", "3100", "3000"]
    assert parameters.get_param("csa.ps_keys") == ["opex_rd", "sga"]
    assert parameters.get_param("beat.non_base_eroding") == ["cogs"]
    assert parameters.get_param("beat.payment_types") == [
        "royalties", "services", "interest", "cogs", "other",
    ]


def test_get_param_returns_parsed_dict(state_db):
    parameters.seed_if_empty()
    racct = parameters.get_param("beat.racct_type")
    assert isinstance(racct, dict)
    assert racct == {
        "0510000": "cogs",
        "0820000": "cogs",
        "0810000": "services",
        "0855000": "royalties",
        "0925000": "interest",
    }


def test_get_param_unknown_returns_default(state_db):
    parameters.seed_if_empty()
    assert parameters.get_param("does.not.exist", 42) == 42


def test_list_params_filters_by_category(state_db):
    parameters.seed_if_empty()
    beat = parameters.list_params(category="beat")
    assert beat
    assert all(p["category"] == "beat" for p in beat)


def test_set_param_updates_and_logs(state_db):
    parameters.seed_if_empty()
    after = parameters.set_param("csa.growth", 0.12, "u_demo", rationale="model refresh")
    assert after["value"] == 0.12
    assert parameters.get_param("csa.growth") == 0.12

    events = audit.list_events(record_ref="param:csa.growth")
    edited = [e for e in events if e["event_type"] == "edited"]
    assert len(edited) == 1
    assert edited[0]["actor"] == "u_demo"
    assert edited[0]["before"]["value"] == 0.08
    assert edited[0]["after"]["value"] == 0.12
    assert edited[0]["rationale"] == "model refresh"
    assert audit.verify_chain()["ok"] is True


def test_set_param_dict_value(state_db):
    parameters.seed_if_empty()
    new_map = {"0510000": "cogs", "0999000": "royalties"}
    parameters.set_param("beat.racct_type", new_map, "u_demo")
    assert parameters.get_param("beat.racct_type") == new_map
    assert audit.verify_chain()["ok"] is True


def test_set_param_unknown_raises(state_db):
    parameters.seed_if_empty()
    import pytest

    with pytest.raises(ValueError):
        parameters.set_param("nope.key", 1, "u_demo")


def test_reset_param_restores_default(state_db):
    parameters.seed_if_empty()
    parameters.set_param("csa.growth", 0.25, "u_demo")
    assert parameters.get_param("csa.growth") == 0.25

    after = parameters.reset_param("csa.growth", "u_demo")
    assert after["value"] == 0.08
    assert parameters.get_param("csa.growth") == 0.08
    assert audit.verify_chain()["ok"] is True


def test_csa_shares_unchanged_via_api():
    """The byte-identical guarantee: with the seeded defaults equal to the old
    constants, /api/csa rab_share values are the stable expected figures."""
    body = client.get("/api/csa", params={"year": 2026}).json()
    shares = {p["rbukrs"]: round(p["rab_share"], 6) for p in body["participants"]}
    assert shares["1000"] == 0.563752
    assert shares["3100"] == 0.257436
    assert shares["3800"] == 0.178812
    assert body["pct_mult"] == 3
    assert body["growth"] == 0.08


# ---- GP5: one governed-parameter edit policy (required rationale + bounds) ----
#
# The two DIRECT edit paths (DriversTab dialog, cockpit inline pencil) now share
# ONE hardened dialog and BOTH layers guard the write: the router requires a
# non-empty rationale, and the store enforces a numeric parameter's governed
# min/max. Scenario promotion (the reviewed path) is unaffected — it always
# passes a synthetic promotion rationale and its overrides stay in bounds.


def test_set_param_enforces_bounds(state_db):
    """A numeric parameter's seeded min/max is enforced at the store layer."""
    import pytest

    parameters.seed_if_empty()
    # csa.growth is bounded 0.0 … 1.0 in the seed.
    with pytest.raises(ValueError):
        parameters.set_param("csa.growth", 5.0, "u_demo", rationale="too high")
    with pytest.raises(ValueError):
        parameters.set_param("csa.growth", -0.1, "u_demo", rationale="too low")
    # In-bounds still writes.
    after = parameters.set_param("csa.growth", 0.5, "u_demo", rationale="in bounds")
    assert after["value"] == 0.5
    assert parameters.get_param("csa.growth") == 0.5
    assert audit.verify_chain()["ok"] is True


def test_set_param_open_upper_bound(state_db):
    """csa.pct_mult has min 0 but a null max — any value >= 0 is accepted."""
    parameters.seed_if_empty()
    after = parameters.set_param("csa.pct_mult", 99, "u_demo", rationale="big")
    assert after["value"] == 99
    import pytest

    with pytest.raises(ValueError):
        parameters.set_param("csa.pct_mult", -1, "u_demo", rationale="negative")


def test_set_param_bounds_ignore_non_numeric(state_db):
    """Bounds only constrain numeric scalars; null-bounds / non-numeric params
    (dict, string, bool) are never blocked."""
    parameters.seed_if_empty()
    # dict param (null bounds)
    parameters.set_param(
        "beat.racct_type", {"0510000": "cogs"}, "u_demo", rationale="remap"
    )
    # bool param (null bounds)
    parameters.set_param("pl.use_post_charge", True, "u_demo", rationale="flip")
    assert parameters.get_param("pl.use_post_charge") is True
    assert audit.verify_chain()["ok"] is True


def test_patch_requires_rationale(state_db):
    """The PATCH endpoint rejects a missing / empty / whitespace-only rationale."""
    parameters.seed_if_empty()
    # missing rationale
    r = client.patch("/api/parameters/csa.growth", json={"value": 0.1, "actor": "u"})
    assert r.status_code == 400
    # empty rationale
    r = client.patch(
        "/api/parameters/csa.growth", json={"value": 0.1, "actor": "u", "rationale": ""}
    )
    assert r.status_code == 400
    # whitespace-only rationale
    r = client.patch(
        "/api/parameters/csa.growth",
        json={"value": 0.1, "actor": "u", "rationale": "   "},
    )
    assert r.status_code == 400
    # nothing was written
    assert parameters.get_param("csa.growth") == 0.08


def test_patch_with_rationale_succeeds_and_audits(state_db):
    """A non-empty rationale writes the value and is recorded in the audit event."""
    parameters.seed_if_empty()
    r = client.patch(
        "/api/parameters/csa.growth",
        json={"value": 0.12, "actor": "u_demo", "rationale": "model refresh"},
    )
    assert r.status_code == 200
    assert r.json()["value"] == 0.12
    assert parameters.get_param("csa.growth") == 0.12
    edited = [
        e
        for e in audit.list_events(record_ref="param:csa.growth")
        if e["event_type"] == "edited"
    ]
    assert len(edited) == 1
    assert edited[0]["rationale"] == "model refresh"
    assert audit.verify_chain()["ok"] is True


def test_patch_out_of_bounds_returns_400(state_db):
    """An in-range rationale but out-of-range value maps the store ValueError to 400."""
    parameters.seed_if_empty()
    r = client.patch(
        "/api/parameters/csa.growth",
        json={"value": 5, "actor": "u_demo", "rationale": "way too high"},
    )
    assert r.status_code == 400
    assert parameters.get_param("csa.growth") == 0.08  # unchanged


def test_patch_in_bounds_succeeds(state_db):
    """An in-range value with a rationale writes through."""
    parameters.seed_if_empty()
    r = client.patch(
        "/api/parameters/csa.growth",
        json={"value": 0.5, "actor": "u_demo", "rationale": "in bounds"},
    )
    assert r.status_code == 200
    assert parameters.get_param("csa.growth") == 0.5


def test_patch_unknown_param_returns_404(state_db):
    """An unknown key stays a 404 even with a valid rationale."""
    parameters.seed_if_empty()
    r = client.patch(
        "/api/parameters/nope.key",
        json={"value": 1, "actor": "u_demo", "rationale": "x"},
    )
    assert r.status_code == 404


def test_scenario_promotion_still_applies_in_bounds(state_db):
    """The reviewed path is unaffected: apply_promotion writes each override via
    set_param with a synthetic rationale, and in-bounds overrides land."""
    import state.scenarios as scenarios

    parameters.seed_if_empty()
    sc = scenarios.create_scenario(
        name="Growth 10%", overrides={"csa.growth": 0.10}, actor="u_maria"
    )
    scenarios.submit_for_review(sc["id"], maker="u_maria")
    scenarios.apply_promotion(sc["id"], checker="u_sam")
    assert parameters.get_param("csa.growth") == 0.10
    edited = [
        e
        for e in audit.list_events(record_ref="param:csa.growth")
        if e["event_type"] == "edited"
    ]
    assert edited and edited[0]["rationale"]  # non-empty synthetic rationale
    assert audit.verify_chain()["ok"] is True


def test_scenario_promotion_fails_closed_on_out_of_bounds(state_db):
    """A scenario mixing an in-bounds and an out-of-bounds override must NOT
    half-apply: promotion is blocked before the first write, so NEITHER
    governed value changes, no param:{key} edit is written, and the scenario is
    not left partially promoted (GP5 review fix — all-or-nothing)."""
    import pytest
    import state.scenarios as scenarios

    parameters.seed_if_empty()
    growth_before = parameters.get_param("csa.growth")   # 0.08 (bounds 0.0…1.0)
    rate_before = parameters.get_param("beat.rate_pct")  # 10.0 (bounds 0.0…100.0)

    # csa.growth 0.10 is in bounds; beat.rate_pct 999 exceeds the max of 100.
    sc = scenarios.create_scenario(
        name="Mixed", overrides={"csa.growth": 0.10, "beat.rate_pct": 999},
        actor="u_maria",
    )
    scenarios.submit_for_review(sc["id"], maker="u_maria")

    # Approving triggers apply_promotion, which must raise BEFORE any set_param.
    with pytest.raises(ValueError):
        scenarios.apply_promotion(sc["id"], checker="u_sam")

    # Fail closed: NEITHER governed value changed — not even the in-bounds one.
    assert parameters.get_param("csa.growth") == growth_before
    assert parameters.get_param("beat.rate_pct") == rate_before
    # No param edit was written for either key.
    for key in ("csa.growth", "beat.rate_pct"):
        edited = [
            e
            for e in audit.list_events(record_ref=f"param:{key}")
            if e["event_type"] == "edited"
        ]
        assert edited == []
    # The scenario was NOT marked promoted (no half-applied state).
    assert scenarios.get_scenario(sc["id"])["status"] == "in_review"
    # The hash-chain is intact.
    assert audit.verify_chain()["ok"] is True
