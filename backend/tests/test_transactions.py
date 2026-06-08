"""Transaction pricing endpoint — settable per-material price rows (OTP-4/1/2).

Run from `backend/`:  python -m pytest tests/test_transactions.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

ENTITY_NAMES = {
    "US IP Principal Co.", "Germany Manufacturing Co.", "Switzerland IP Principal",
    "France Distribution Co.", "UK Distribution Co.", "Ireland Financing Co.",
    "Netherlands Distribution Co.", "India Toll Manufacturer",
}
BENCH_IDS = {"BM-SVC", "BM-TOLL", "BM-LRD"}


def test_pricing_shape_and_derivation():
    rows = client.get("/api/transactions/pricing").json()
    assert isinstance(rows, list) and rows
    seen_service = seen_goods = False
    for r in rows:
        # one row per chain+material, not per role
        assert r["materialType"] in {"SERVICE", "FG", "SEMI", "RAW"}
        assert r["transactionType"] in {"service", "goods"}
        # every settable field is present and numeric
        assert r["standardCost"] >= 0
        assert r["totalLegalPrice"] >= 0
        assert isinstance(r["markupRate"], (int, float))
        assert r["tpMethod"]
        # entity pair resolves to display names
        assert r["seller"] in ENTITY_NAMES and r["buyer"] in ENTITY_NAMES
        # benchmark band derived from the seed
        assert r["benchmarkId"] in BENCH_IDS
        assert "%" in r["benchmarkRange"]
        assert isinstance(r["withinBenchmark"], bool)
        if r["transactionType"] == "service":
            seen_service = True
            assert r["benchmarkId"] == "BM-SVC"
        else:
            seen_goods = True
            assert r["benchmarkId"] in {"BM-LRD", "BM-TOLL"}
    assert seen_service and seen_goods


def test_pricing_rows_are_per_chain_material_unique():
    rows = client.get("/api/transactions/pricing").json()
    keys = {(r["chainId"], r["materialType"]) for r in rows}
    assert len(keys) == len(rows)  # one row per (chain, material)


def test_pricing_within_benchmark_matches_band():
    rows = client.get("/api/transactions/pricing").json()
    bench = client.get("/api/reference/benchmarks").json()["sets"]
    bands = {s["set_id"]: s for s in bench}
    for r in rows:
        b = bands[r["benchmarkId"]]
        expected = b["lower"] <= r["markupRate"] <= b["upper"]
        assert r["withinBenchmark"] == expected
