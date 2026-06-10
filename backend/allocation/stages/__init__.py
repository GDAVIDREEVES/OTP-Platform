"""Engine stages (SPEC §4) — each a pure function
``(inputs, ref_data, config) -> {"outputs", "exceptions", "log"}``.

No stage reads the database; the orchestrator
(services/allocation_runner.py, M6) loads + hashes inputs, composes the
stages and persists outputs atomically. M2 ships Stages 1-3, M3 ships
Stage 4 (flat), M4 ships Stages 5-6 (markup, FX/charge-out), M5 the cascade/
reciprocal orchestration path, M6 Stage 7 (reconcile) + true-up (§5.4).
"""

from allocation.stages.stage1_capture import stage1_capture_and_classify
from allocation.stages.stage2_pool import stage2_pool
from allocation.stages.stage3_benefit_gate import stage3_benefit_gate
from allocation.stages.stage4_allocate import stage4_allocate
from allocation.stages.stage5_markup import stage5_markup
from allocation.stages.stage6_chargeout import stage6_chargeout
from allocation.stages.stage7_reconcile import stage7_reconcile

__all__ = [
    "stage1_capture_and_classify",
    "stage2_pool",
    "stage3_benefit_gate",
    "stage4_allocate",
    "stage5_markup",
    "stage6_chargeout",
    "stage7_reconcile",
]
