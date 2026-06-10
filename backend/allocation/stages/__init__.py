"""Engine stages (SPEC §4) — each a pure function
``(inputs, ref_data, config) -> {"outputs", "exceptions", "log"}``.

No stage reads the database; the orchestrator (M6) loads + hashes inputs,
composes the stages and persists outputs atomically. M2 ships Stages 1-3,
M3 ships Stage 4 (flat); Stages 5-6 (M4), cascade/reciprocal (M5) and
Stage 7 (M6) follow the milestone gates.
"""

from allocation.stages.stage1_capture import stage1_capture_and_classify
from allocation.stages.stage2_pool import stage2_pool
from allocation.stages.stage3_benefit_gate import stage3_benefit_gate
from allocation.stages.stage4_allocate import stage4_allocate

__all__ = [
    "stage1_capture_and_classify",
    "stage2_pool",
    "stage3_benefit_gate",
    "stage4_allocate",
]
