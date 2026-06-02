"""The by-analogy mapping proposer — deterministic, offline-safe."""
from __future__ import annotations

from services.mapping_ai import propose_mapping


def test_proposes_lrd_for_distribution_entity():
    item = {"kind": "entity", "raw": {"rbukrs": "3500", "name": "Spain Distribution Co.", "currency": "EUR", "country_hint": "Spain"}}
    out = propose_mapping(item)
    assert out["proposed"]["tp_function_code"] == "LRD"
    assert out["proposed"]["tested_party"] is True
    assert out["confidence"] in {"High", "Medium", "Low"}
    assert out["rationale"]


def test_proposes_roytm_for_trademark_royalty_account():
    item = {"kind": "account", "raw": {"account": "417000", "text": "Royalty expense - trademark"}}
    out = propose_mapping(item)
    assert out["proposed"]["txn_type_id"] == "ROY-TM"


def test_proposes_services_for_rd_transaction():
    item = {"kind": "transaction", "raw": {"label": "Contract R&D services", "payer_rbukrs": "3000", "payee_rbukrs": "4100"}}
    out = propose_mapping(item)
    assert out["proposed"]["txn_type_id"] == "SVC"


def test_unknown_entity_is_low_confidence_not_crash():
    out = propose_mapping({"kind": "entity", "raw": {"rbukrs": "9999", "name": "Zeta Holdings", "currency": "USD"}})
    assert out["proposed"]["tp_function_code"] in {"PRIN", "LRD", "SVC", "TREAS", "FRMFG", "TOLL", "IPOWN"}
    assert out["confidence"] == "Low"
