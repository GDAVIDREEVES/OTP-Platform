"""Dataset / data-prep API (Phase 8 DS1).

Thin router over ``calc/dataset.py`` (the graph -> safe parameterized DuckDB SQL
compiler + the source allowlist). A dataset is a VISUAL data-prep layer: a
subgraph compiles to ONE CTE-chain query run through ``db.q`` — there is no new
data engine here.

* ``GET  /api/dataset/sources`` — the palette catalogue: every source (the four
  real warehouse views + the fabricated allocation cost lines) with its columns
  (role + type), provenance, join keys and enumerable dimensions, plus the real
  distinct GL / CC / PC value lists for the journal. Pure read.
* ``POST /api/dataset/validate`` — ``dataset.validate_dataset`` -> ``{ok,
  errors, output_columns}``. Pure read; nothing persists, no SQL runs.
* ``POST /api/dataset/preview`` — compile + run the graph -> ``{columns, rows
  (sample), row_count}``. Pure read; nothing persists.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

import calc.dataset as dataset
from schemas.dataset import DatasetIn, DatasetPreviewIn

router = APIRouter()


@router.get("/api/dataset/sources")
def sources():
    """The palette catalogue (sources + columns + provenance + journal distinct
    GL/CC/PC values). Pure read — nothing persists."""
    return dataset.sources_catalog()


@router.post("/api/dataset/validate")
def validate(payload: DatasetIn):
    """Structural + allowlist validation: ``{ok, errors: [{message, node_id}],
    output_columns}``. Nothing persists and no SQL runs."""
    return dataset.validate_dataset(payload.graph)


@router.post("/api/dataset/preview")
def preview(payload: DatasetPreviewIn):
    """Compile the dataset graph to one parameterized DuckDB query and run it ->
    ``{columns, rows, row_count}`` (rows sample-capped). A graph problem returns
    a precise 400 ``{message, node_id}`` (the allowlist compiler's error) rather
    than emitting any SQL. Nothing persists."""
    report = dataset.validate_dataset(payload.graph)
    if not report["ok"]:
        err = report["errors"][0] if report["errors"] else {"message": "invalid dataset"}
        raise HTTPException(status_code=400, detail=err)
    try:
        result = dataset.run_dataset(payload.graph, sample_limit=payload.sample_limit)
    except dataset.DatasetError as e:
        raise HTTPException(
            status_code=400,
            detail={"message": e.message, "node_id": e.node_id})
    return result
