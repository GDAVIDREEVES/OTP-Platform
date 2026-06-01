"""Environment configuration for the OTP Platform backend."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).parent
REPO_ROOT = BASE_DIR.parent

# Path to the directory containing the parquet sub-folders:
#   entity_roles/  segment_pl/  supply_chain_flows/  journal_entries/
# Defaults to the committed sample dataset (data/parquet/) so a fresh clone
# boots. Point DATA_DIR at a full ACDOCA export — e.g. in backend/.env — for
# full-fidelity demos.
DATA_DIR = Path(os.getenv("DATA_DIR", str(REPO_ROOT / "data" / "parquet")))

CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://localhost:3000"
    ).split(",")
    if o.strip()
]

# Glob patterns DuckDB feeds to read_parquet().
ENTITY_ROLES = str(DATA_DIR / "entity_roles" / "*.parquet")
SEGMENT_PL = str(DATA_DIR / "segment_pl" / "*.parquet")
SUPPLY_CHAIN = str(DATA_DIR / "supply_chain_flows" / "*.parquet")
JOURNAL = str(DATA_DIR / "journal_entries" / "*.parquet")

HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))
