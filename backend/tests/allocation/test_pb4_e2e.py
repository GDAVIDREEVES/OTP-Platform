"""PB4 gate — end-to-end Allocation Pool Builder loop (Phase 6).

PB1 seeded the richer cost-center layer, PB2 built the store + engine
integration, PB3 wired the routes. PB4 pins the WHOLE loop the demo walks —
over HTTP, the real path the UI drives — and the two invariants the user cares
about:

    build (preview captured cost) → test (zero-residual recon + trace) →
    submit-activation → approve as a DIFFERENT actor (maker-checker) →
    run the authored allocation → charges + recon Balanced + DOC PACK

plus, with that authored pool active and an authored run already persisted:

    the GOVERNED demo allocation is still cent-exact — FY cost-recovered
    13,586,402.70 / FY gross 14,344,773.26 — and never perturbed.

The doc pack is the PB4 addition over PB3: an authored run now emits one
per-pool SPEC §8.3 service-charge memo under ``docs/``, the same builder the
governed run uses, so "build → run → read the memo" lands on a real document.

Decimal money throughout — no float arithmetic on any amount (ENGINE-CLAUDE.md).

Run from backend/:
    ../.venv/bin/python -m pytest tests/allocation/test_pb4_e2e.py
"""

from __future__ import annotations

from decimal import Decimal

from fastapi.testclient import TestClient

import services.allocation_runner as runner
import state.allocation_store as store
from main import app

client = TestClient(app)

ZERO = Decimal("0")
PERIODS = ["2026-04", "2026-05", "2026-10", "2026-11"]


def _sound_def() -> dict:
    """Capture provider-1000 IT-OPS cost centers, beneficiary 3000 (DE), equal
    key, one DE markup policy — touches 2026-05 / 2026-11."""
    return {
        "name": "Authored IT Ops (PB4)",
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


def test_full_loop_build_to_docpack_over_http(state_db):
    """The whole authored-pool loop over HTTP: preview → create → test →
    submit → approve (different actor) → run → charges/recon Balanced + doc pack.
    """
    defn = _sound_def()

    # 1. preview — captured cost ties to the hand-summed cost-line subset.
    want = sum(
        (Decimal(l["amount_local"])
         for l in runner.load_demo_dataset()["cost_lines"]["actual"]
         if l["cost_center"] in defn["cost_capture_rule"]["cost_centers"]),
        ZERO)
    r = client.post("/api/allocation/pools/preview",
                    json={"cost_centers": defn["cost_capture_rule"]["cost_centers"]})
    assert r.status_code == 200
    assert Decimal(r.json()["captured_amount"]) == want
    assert Decimal(r.json()["by_entity"]["1000"]) == want

    # 2. create draft.
    r = client.post("/api/allocation/pools",
                    json={"definition": defn, "actor": "maker_alice"})
    assert r.status_code == 200
    pid = r.json()["id"]
    assert r.json()["status"] == "draft"

    # 3. test — dry-run through Stages 1-7: zero residual + trace present.
    r = client.post(f"/api/allocation/pools/{pid}/test",
                    json={"actor": "maker_alice"})
    assert r.status_code == 200
    dry = r.json()["dry_run"]
    assert r.json()["tested"] is True
    assert dry["balanced"] is True
    assert dry["exceptions"] == []
    assert dry["trace"], "dry-run must carry a trace"
    for row in dry["recon"]:
        assert row["recon_status"] == "Balanced"
        assert Decimal(row["unallocated_residual"]) == ZERO

    # 4. submit for activation (maker) → in_review.
    r = client.post(f"/api/allocation/pools/{pid}/submit-activation",
                    json={"maker": "maker_alice"})
    assert r.status_code == 200
    assert r.json()["status"] == "in_review"

    # 5. approve as a DIFFERENT actor — maker-checker.
    item = next(i for i in client.get("/api/review-queue").json()
                if i["record_ref"] == f"allocpool:{pid}")
    # the maker cannot approve their own work.
    blocked = client.post(f"/api/review/{item['id']}/approve",
                          json={"checker": "maker_alice"})
    assert blocked.status_code >= 400
    decided = client.post(f"/api/review/{item['id']}/approve",
                          json={"checker": "checker_bob"})
    assert decided.status_code == 200
    active = client.get(f"/api/allocation/pools/{pid}").json()
    assert active["status"] == "active"
    assert active["activated_by"] == "checker_bob"

    # 6. run the authored allocation — succeeded, balanced, flagged authored.
    r = client.post("/api/allocation/authored-runs",
                    json={"actor": "ops_carol", "period": "2026-05"})
    assert r.status_code == 200
    run = r.json()
    s = run["summary"]
    assert s["status"] == "succeeded"
    assert s["authored"] is True
    assert s["recon_balanced"] is True
    assert s["authored_pool_ids"] == [pid]

    # 7. charges + recon Balanced + DOC PACK.
    assert run["recon"] and all(
        row["recon_status"] == "Balanced" for row in run["recon"])
    docs = [a for a in run["artifacts"] if a.startswith("docs/")]
    assert docs, "authored run must emit a doc pack"
    assert f"docs/{pid}.md" in docs
    memo = store.get_artifact(run["run_id"], f"docs/{pid}.md")
    assert memo is not None
    body = memo["content"]
    assert "# Service charge documentation" in body
    assert f"**Run:** {run['run_id']}" in body
    assert "## 5. Allocation key" in body


def test_governed_run_cent_exact_with_authored_pool_active(state_db):
    """With an authored pool ACTIVE and an authored run already persisted in the
    SAME DB, the governed demo allocation is still cent-exact — authored pools
    are isolated experiments and never perturb the governed tie-out."""
    # Build + activate + run an authored pool (lands rows on the same ledgers).
    r = client.post("/api/allocation/pools",
                    json={"definition": _sound_def(), "actor": "maker_alice"})
    pid = r.json()["id"]
    client.post(f"/api/allocation/pools/{pid}/test", json={"actor": "maker_alice"})
    client.post(f"/api/allocation/pools/{pid}/submit-activation",
                json={"maker": "maker_alice"})
    item = next(i for i in client.get("/api/review-queue").json()
                if i["record_ref"] == f"allocpool:{pid}")
    client.post(f"/api/review/{item['id']}/approve", json={"checker": "checker_bob"})
    client.post("/api/allocation/authored-runs",
                json={"actor": "ops_carol", "period": "2026-05"})

    # Now run the GOVERNED allocation across the full year — cent-exact.
    fy_cost = ZERO
    fy_gross = ZERO
    for period in PERIODS:
        res = runner.run_allocation(period=period, run_type="actual", actor="gov")
        assert res["summary"]["recon_balanced"] is True
        assert res["exception_report"]["exceptions"] == []
        for row in store.list_charges(run_id=res["run_id"]):
            fy_cost += Decimal(row["cost_recovered_amount"])
            fy_gross += Decimal(row["gross_charge_amount"])
    assert fy_cost == Decimal("13586402.70")
    assert fy_gross == Decimal("14344773.26")


def test_authored_pool_surfaced_on_provenance_dashboard(state_db):
    """The provenance dashboard shows the richer (fabricated) cost-center layer
    AND the authored-pools store as a governed (real) source — provenance-honest:
    the fabricated finer cost lines are flagged fabricated; the authored-pools
    table is a real governed store whose rows are flagged authored at row level.
    """
    body = client.get("/api/catalog/provenance").json()
    fab = {i["name"] for i in body["buckets"]["fabricated"]["items"]}
    real = {i["name"] for i in body["buckets"]["real"]["items"]}
    # richer cost-center layer (PB1) — fabricated.
    assert "allocation_cost_lines" in fab
    assert "allocation_cc_mapping" in fab
    # authored-pool store (PB2) — a real governed source.
    assert "authored_pools" in real
