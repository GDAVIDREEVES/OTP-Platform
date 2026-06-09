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
