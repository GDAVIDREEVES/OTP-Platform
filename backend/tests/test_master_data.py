"""Master-data seeds, resolution, and matrix composition."""
from __future__ import annotations

from state import master_data as md


def test_functions_seed_is_controlled_vocab():
    codes = {f["code"] for f in md.functions()}
    assert {"LRD", "TOLL", "IPOWN", "SVC", "TREAS", "FRMFG", "PRIN"} <= codes


def test_resolve_lrd_distribution_to_tnmm_range():
    r = md.resolve("LRD", "Distribution")
    assert r is not None
    assert r["txn_type_id"] == "DIST-LRD"
    assert r["method"] == "TNMM"
    assert r["pli"] == "operating_margin"
    assert (r["lower"], r["median"], r["upper"]) == (2.0, 3.0, 4.0)


def test_resolve_toll_manufacturing_to_benchmark():
    r = md.resolve("TOLL", "Manufacturing")
    assert r["benchmark_set_id"] == "BM-TOLL"
    assert (r["lower"], r["upper"]) == (5.0, 12.0)


def test_resolve_unknown_pair_returns_none():
    assert md.resolve("LRD", "Manufacturing") is None


def test_entity_function_seed_has_multi_hat_entity():
    import json
    from pathlib import Path
    p = Path("seeds/master_data/entity_functions.v1.json")
    asn = json.loads(p.read_text())["assignments"]
    by_rb: dict[str, int] = {}
    for a in asn:
        by_rb[a["rbukrs"]] = by_rb.get(a["rbukrs"], 0) + 1
    assert by_rb["1000"] == 2  # Principal + IP Owner
    assert by_rb["3000"] == 2  # Full-Risk Mfr + Service Provider
    lrds = [a for a in asn if a["tp_function_code"] == "LRD"]
    assert {a["rbukrs"] for a in lrds} == {"3200", "3300", "3800"}


from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_entities_endpoint_returns_entity_function_grain(state_db):
    md.seed_if_empty()
    rows = client.get("/api/master-data/entities").json()
    by_rb = [r for r in rows if r["rbukrs"] == "1000"]
    assert {r["tp_function_code"] for r in by_rb} == {"PRIN", "IPOWN"}
    assert by_rb[0]["tp_function_label"]  # resolved label
    assert by_rb[0]["functional_currency"] == "USD"


def test_matrix_endpoint_composes_and_resolves(state_db):
    md.seed_if_empty()
    rows = client.get("/api/master-data/matrix").json()
    fr = next(r for r in rows if r["ctx_id"] == "CTX-DIST-FR")
    assert fr["method"] == "TNMM"
    assert fr["lower"] == 2.0 and fr["upper"] == 4.0
    assert fr["policy_ref"] == "POL-DIS-26"
    assert fr["status"] in {"in_range", "review", "na"}
    assert fr["payer"]["role"] and fr["tested"]["role"]  # roles from the master
    # the trademark royalty must resolve to its OWN benchmark, not the API royalty's
    tm = next(r for r in rows if r["ctx_id"] == "CTX-ROY-TM")
    assert tm["benchmark_set_id"] == "BM-ROY-TM"
    assert tm["upper"] == 4.0


def test_transaction_types_and_functions_endpoints(state_db):
    md.seed_if_empty()
    assert client.get("/api/master-data/functions").status_code == 200
    tt = client.get("/api/master-data/transaction-types").json()
    assert any(t["txn_type_id"] == "DIST-LRD" for t in tt)


def test_entity_participation_derives_from_covered(state_db):
    md.seed_if_empty()
    part = md.entity_participation()
    # 3000 (Germany) is payer on royalty + distribution flows and the SVC tested party
    assert "Royalty — patented API" in part["3000"]
    assert "Distribution (LRD)" in part["3000"]
    # entity_master rows expose participates_in
    rows = md.entity_master()
    de = [r for r in rows if r["rbukrs"] == "3000"][0]
    assert de["participates_in"] == part["3000"]
