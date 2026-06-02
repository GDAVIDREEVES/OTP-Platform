"""Master Data workspace — the front of the close cycle."""
from __future__ import annotations

from fastapi import APIRouter

from state import master_data as md

router = APIRouter()


@router.get("/api/master-data/functions")
def functions():
    return md.functions()


@router.get("/api/master-data/transaction-types")
def transaction_types():
    return md.transaction_types()


@router.get("/api/master-data/entities")
def entities():
    return md.entity_master()


@router.get("/api/master-data/matrix")
def matrix():
    return md.matrix()
