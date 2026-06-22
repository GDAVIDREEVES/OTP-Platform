"""First-class authored datasets API (Phase 8 DS2).

Thin router over ``state/authored_datasets.py`` (draft -> tested -> in_review ->
active lifecycle) and ``calc/dataset.py`` (the graph -> safe parameterized
DuckDB SQL compiler). A dataset is a VISUAL data-prep layer: its graph compiles
to ONE CTE-chain query run through ``db.q`` — there is no new data engine.

Route order: the literal ``/api/datasets/validate`` and ``.../preview`` routes
register before the parameterised ``/api/datasets/{dataset_id}`` routes so they
never collide. ``validate`` and ``preview`` are pure reads — nothing persists,
nothing is audited — so the Builder can syntax-check / live-preview on every
keystroke. Activation happens in the /review queue (a DIFFERENT checker approves
the ``dataset:{id}`` item; see state/review.py:decide()).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

import calc.dataset as dataset
import state.authored_datasets as authored_datasets
from schemas.dataset import (
    AuthoredDatasetIn,
    AuthoredDatasetPatch,
    DatasetActorIn,
    DatasetIn,
    DatasetMakerIn,
    DatasetPreviewIn,
)

router = APIRouter()


def _http_error(e: ValueError) -> HTTPException:
    msg = str(e)
    if msg.startswith("unknown authored dataset"):
        return HTTPException(status_code=404, detail=msg)
    if msg.startswith("invalid authored dataset") or msg.startswith(
            "dataset test run failed"):
        return HTTPException(status_code=400, detail=msg)
    return HTTPException(status_code=409, detail=msg)


# --------------------------------------------------------------- pure reads --


@router.get("/api/datasets")
def list_datasets(status: str | None = None):
    return authored_datasets.list_authored_datasets(status=status)


@router.post("/api/datasets/validate")
def validate_dataset(payload: DatasetIn):
    """Structural + allowlist validation report ``{ok, errors, output_columns}``
    — nothing persists, no SQL runs."""
    return dataset.validate_dataset(payload.graph)


@router.post("/api/datasets/preview")
def preview_dataset(payload: DatasetPreviewIn):
    """Compile the dataset graph to one parameterized DuckDB query and run it ->
    ``{columns, rows, row_count}`` (rows sample-capped). A graph problem returns
    a precise 400 ``{message, node_id}`` rather than emitting any SQL. Nothing
    persists — the Builder's live preview."""
    report = dataset.validate_dataset(payload.graph)
    if not report["ok"]:
        err = report["errors"][0] if report["errors"] else {"message": "invalid dataset"}
        raise HTTPException(status_code=400, detail=err)
    try:
        return dataset.run_dataset(payload.graph, sample_limit=payload.sample_limit)
    except dataset.DatasetError as e:
        raise HTTPException(
            status_code=400, detail={"message": e.message, "node_id": e.node_id})


# ------------------------------------------------------------------ writes --


@router.post("/api/datasets")
def create_dataset(payload: AuthoredDatasetIn):
    """Create a draft authored dataset from a data-prep ``definition`` graph."""
    try:
        return authored_datasets.create_authored_dataset(
            name=payload.name, definition=payload.definition,
            actor=payload.actor, description=payload.description,
            process_id=payload.process_id,
        )
    except ValueError as e:
        raise _http_error(e)


@router.get("/api/datasets/{dataset_id}")
def get_dataset(dataset_id: str):
    d = authored_datasets.get_authored_dataset(dataset_id)
    if d is None:
        raise HTTPException(
            status_code=404, detail=f"unknown authored dataset: {dataset_id}")
    return d


@router.patch("/api/datasets/{dataset_id}")
def update_dataset(dataset_id: str, payload: AuthoredDatasetPatch):
    try:
        return authored_datasets.update_authored_dataset(
            dataset_id, actor=payload.actor, name=payload.name,
            description=payload.description, definition=payload.definition,
            process_id=payload.process_id,
        )
    except ValueError as e:
        raise _http_error(e)


@router.delete("/api/datasets/{dataset_id}")
def delete_dataset(dataset_id: str, payload: DatasetActorIn):
    try:
        return authored_datasets.delete_authored_dataset(
            dataset_id, actor=payload.actor)
    except ValueError as e:
        raise _http_error(e)


@router.post("/api/datasets/{dataset_id}/test")
def test_dataset(dataset_id: str, payload: DatasetActorIn):
    """Compile + run the dataset graph (no persist). On success it is marked
    ``tested`` — the gate submit-activation requires. Returns the preview
    result (columns / sample rows / row count)."""
    try:
        return authored_datasets.test_run(dataset_id, actor=payload.actor)
    except ValueError as e:
        raise _http_error(e)


@router.post("/api/datasets/{dataset_id}/submit-activation")
def submit_activation(dataset_id: str, payload: DatasetMakerIn):
    """Submit for activation: status -> in_review + one pending maker-checker
    item at dataset:{id}. The dataset activates only when a DIFFERENT reviewer
    approves the item in the /review queue."""
    try:
        return authored_datasets.submit_for_activation(
            dataset_id, maker=payload.maker)
    except ValueError as e:
        raise _http_error(e)
