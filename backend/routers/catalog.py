"""Data catalog API (Phase 2c) — the governed inventory of every data source.

GET /api/catalog              full list (warehouse views + state tables + seeds + parameters)
GET /api/catalog/provenance   rollup grouping every source by provenance + counts
GET /api/catalog/{id}         one entry (404 if unknown)

The ``/provenance`` route is declared before ``/{id}`` so the literal path
wins over the id capture.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from services import catalog

router = APIRouter()


@router.get("/api/catalog")
def list_catalog():
    return catalog.catalog()


@router.get("/api/catalog/provenance")
def catalog_provenance():
    return catalog.provenance_rollup()


@router.get("/api/catalog/{entry_id:path}")
def get_catalog_entry(entry_id: str):
    e = catalog.entry(entry_id)
    if e is None:
        raise HTTPException(status_code=404, detail=f"unknown catalog entry: {entry_id}")
    return e
