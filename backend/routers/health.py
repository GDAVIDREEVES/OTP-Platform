from fastapi import APIRouter

from config import DATA_DIR, ENTITY_ROLES
from db import q

router = APIRouter()


@router.get("/api/health")
def health():
    rows = q(f"SELECT COUNT(*) AS n FROM read_parquet('{ENTITY_ROLES}')")
    return {
        "ok": True,
        "data_dir": str(DATA_DIR),
        "entity_roles_rows": rows[0]["n"],
    }
