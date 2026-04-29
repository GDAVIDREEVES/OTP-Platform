"""Static dimension tables and label maps used across the API."""

from __future__ import annotations

import json

from config import BASE_DIR

# Static dimension table: SAP company code (RBUKRS) -> display fields used by the UI
with open(BASE_DIR / "dim" / "entity_dim.json", encoding="utf-8") as f:
    ENTITY_DIM = {row["rbukrs"]: row for row in json.load(f)["entities"]}

# Local-currency lookup so amounts come back tagged correctly.
# Derived once from journal_entries' RHCUR; encoded statically for performance.
ENTITY_CCY = {
    "1000": "USD", "3000": "EUR", "3100": "CHF", "3200": "EUR",
    "3300": "GBP", "3400": "EUR", "3800": "EUR", "4100": "INR",
}

# Friendly labels for the role taxonomy
ROLE_FUNCTION = {
    "IPPR": "Principal",
    "FRMF": "Manufacturer",
    "TOLL": "Manufacturer",
    "LRD":  "Distributor",
    "FINC": "Treasury / Finance",
}

MATERIAL_LABELS = {
    "FG":         "Tangible Goods Sales",
    "SEMI":       "Tangible Goods Sales",
    "RAW":        "Tangible Goods Sales",
    "ROYALTY":    "Royalties",
    "SERVICE":    "Management / Concept Fees",
    "COST_SHARE": "Cost Sharing",
}
