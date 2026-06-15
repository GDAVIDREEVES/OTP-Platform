"""PB3 route gate — Pool Builder HTTP surface (Phase 6).

The PB3 frontend drives the authored-pool lifecycle entirely over HTTP. PB2
tested the store + runner directly; this file pins the ROUTES the Builder calls:

- GET  /api/allocation/dimensions          (capture-rule pickers, totals)
- POST /api/allocation/pools/preview       (live captured-cost card)
- POST /api/allocation/pools               (save draft)
- POST /api/allocation/pools/{id}/test     (dry-run → tested)
- POST /api/allocation/pools/{id}/submit-activation  (maker-checker enqueue)
- POST /api/allocation/authored-runs       (NEW in PB3 — run active pools)

The authored run is balanced and flagged ``authored``; the governed seeded
allocation is never reached by these routes. Decimal money — no float math.

Run from backend/:
    ../.venv/bin/python -m pytest tests/allocation/test_pb3_routes.py
"""

from __future__ import annotations

from decimal import Decimal

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def _sound_def() -> dict:
    return {
        "name": "Authored IT Ops",
        "provider_entity_id": "1000",
        "service_line": "IT",
        "characterization": "Routine-benchmarked",
        "cost_base_definition": "Total services cost",
        "cost_capture_rule": {
            "cost_centers": ["CC-1000-IT-OPS-ERP", "CC-1000-IT-OPS-SUPPORT"],
        },
        "beneficiaries": ["3000"],
        "key": {"key_factor": "Equal"},
        "exclusions": [],
        "markup_policies": [{
            "jurisdiction": "DE", "regime": "Benchmarked",
            "markup_pct": "0.05", "benchmark_study_ref": "BM-AP-DE",
        }],
    }


def test_dimensions_lists_dims_with_decimal_totals(state_db):
    r = client.get("/api/allocation/dimensions")
    assert r.status_code == 200
    body = r.json()
    assert body["cost_centers"] and body["profit_centers"] and body["cost_elements"]
    opt = body["cost_centers"][0]
    assert set(opt) == {"value", "total_cost"}
    # Decimal-exact string, never a float repr.
    Decimal(opt["total_cost"])


def test_preview_captures_decimal_amount(state_db):
    r = client.post("/api/allocation/pools/preview", json={
        "cost_centers": ["CC-1000-IT-OPS-ERP", "CC-1000-IT-OPS-SUPPORT"],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["line_count"] >= 1
    assert Decimal(body["captured_amount"]) > 0
    assert "1000" in body["by_entity"]


def test_split_over_range_is_blocked_not_defaulted(state_db):
    r = client.post("/api/allocation/pools/preview", json={
        "cost_centers": ["CC-1000-IT-OPS-ERP"], "split_pct": "1.5",
    })
    assert r.status_code == 400


def test_lifecycle_over_http_then_authored_run(state_db):
    # create draft
    r = client.post("/api/allocation/pools",
                    json={"definition": _sound_def(), "actor": "maker1"})
    assert r.status_code == 200
    pid = r.json()["id"]
    assert r.json()["status"] == "draft"

    # list shows it
    assert any(p["id"] == pid for p in client.get("/api/allocation/pools").json())

    # dry-run → tested
    r = client.post(f"/api/allocation/pools/{pid}/test", json={"actor": "maker1"})
    assert r.status_code == 200
    assert r.json()["tested"] is True
    assert r.json()["dry_run"]["balanced"] is True

    # submit for activation → in_review
    r = client.post(f"/api/allocation/pools/{pid}/submit-activation",
                    json={"maker": "maker1"})
    assert r.status_code == 200
    assert r.json()["status"] == "in_review"

    # a DIFFERENT checker approves the allocpool item in the review queue
    item = next(i for i in client.get("/api/review-queue").json()
                if i["record_ref"] == f"allocpool:{pid}")
    decided = client.post(f"/api/review/{item['id']}/approve",
                          json={"checker": "checker2"})
    assert decided.status_code == 200
    assert client.get(f"/api/allocation/pools/{pid}").json()["status"] == "active"

    # authored run over HTTP — balanced + flagged authored
    r = client.post("/api/allocation/authored-runs",
                    json={"actor": "ops", "period": "2026-05"})
    assert r.status_code == 200
    body = r.json()
    assert body["summary"]["status"] == "succeeded"
    assert body["summary"]["authored"] is True
    assert body["summary"]["recon_balanced"] is True
    assert body["summary"]["authored_pool_ids"] == [pid]
    assert body["recon"] and all(r["recon_status"] == "Balanced" for r in body["recon"])


def test_maker_equals_checker_blocked_over_http(state_db):
    r = client.post("/api/allocation/pools",
                    json={"definition": _sound_def(), "actor": "solo"})
    pid = r.json()["id"]
    client.post(f"/api/allocation/pools/{pid}/test", json={"actor": "solo"})
    client.post(f"/api/allocation/pools/{pid}/submit-activation",
                json={"maker": "solo"})
    item = next(i for i in client.get("/api/review-queue").json()
                if i["record_ref"] == f"allocpool:{pid}")
    # the maker cannot be the checker — the review queue enforces it
    blocked = client.post(f"/api/review/{item['id']}/approve",
                          json={"checker": "solo"})
    assert blocked.status_code >= 400
    assert client.get(f"/api/allocation/pools/{pid}").json()["status"] == "in_review"
