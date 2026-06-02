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
