"""Codegen: docs/allocation/intercompany-allocation-schema.json -> generated code.

The schema JSON is the ONLY source of truth for entity shapes, enumerations and
FK references (ENGINE-CLAUDE.md rule 1). This module renders, deterministically
(byte-identical on re-run):

- ``allocation/generated/types.py``  — TypedDicts per entity sheet, Enum classes
  for the 19 enumerations, and the ``ENTITIES`` metadata that drives schema-level
  validation (V-R1 FK resolution, V-R2 enums) and the persistence layer.
- ``allocation/generated/ddl.sql``   — SQLite DDL (idempotent) for the four
  append-only ledgers (1_CostLine -> cost_lines, 7_KeyValue -> key_values,
  10_ChargeLedger -> charge_ledger, 11_Recon -> recon) plus the
  ``allocation_runs`` run table per SPEC §3.2. Reference sheets (2,3,4,5,6,8,9)
  are seeds, NOT tables (ADAPTATION D1).
- splices the same DDL into ``state/schema.sql`` between markers so
  ``state.engine.init_db()`` creates the tables with everything else.

Run from backend/:  ../.venv/bin/python -m allocation.codegen
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
SCHEMA_PATH = _HERE.parents[1] / "docs" / "allocation" / "intercompany-allocation-schema.json"
GENERATED_DIR = _HERE / "generated"
SCHEMA_SQL_PATH = _HERE.parent / "state" / "schema.sql"

HEADER = "GENERATED - do not edit. Rendered by allocation/codegen.py from docs/allocation/intercompany-allocation-schema.json."

# Engine-persisted sheets -> SQLite table names. Everything else is a seed.
TABLES = {
    "1_CostLine": "cost_lines",
    "7_KeyValue": "key_values",
    "10_ChargeLedger": "charge_ledger",
    "11_Recon": "recon",
}

# data_type -> python annotation. Decimal/Percent are serialized as exact
# decimal STRINGS (never floats — ENGINE-CLAUDE.md "No float math on money").
PY_TYPES = {
    "String/UUID": "str",
    "String": "str",
    "Text": "str",
    "Currency": "str",
    "Date": "str",
    "DateTime": "str",
    "Enum": "str",
    "Decimal": "str",
    "Percent": "str",
    "Boolean": "bool",
    "Integer": "int",
}

# data_type -> SQLite column type. Decimal/Percent stored as TEXT (exact
# decimal strings); Boolean as INTEGER 0/1.
SQL_TYPES = {
    "String/UUID": "TEXT",
    "String": "TEXT",
    "Text": "TEXT",
    "Currency": "TEXT",
    "Date": "TEXT",
    "DateTime": "TEXT",
    "Enum": "TEXT",
    "Decimal": "TEXT",
    "Percent": "TEXT",
    "Boolean": "INTEGER",
    "Integer": "INTEGER",
}

# Enum-typed fields whose name does not literally match an enumeration name.
# 6_KeyDef.recompute_frequency has data_type Enum but NO enumeration entry in
# schema.json — it resolves to None and validates as free text (DECISIONS.md).
ENUM_ALIASES = {
    "function": "function / service_line",
    "service_line": "function / service_line",
    "role": "participation_role",
}

BEGIN_MARK = "-- ==== BEGIN GENERATED ALLOCATION DDL (allocation/codegen.py - do not edit between markers) ===="
END_MARK = "-- ==== END GENERATED ALLOCATION DDL ===="


def load_schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def schema_sha256() -> str:
    return hashlib.sha256(SCHEMA_PATH.read_bytes()).hexdigest()


def class_name(sheet: str) -> str:
    """"1_CostLine" -> "CostLine"."""
    return re.sub(r"^\d+_", "", sheet)


def enum_class_name(enum_name: str) -> str:
    """"function / service_line" -> "FunctionServiceLine"."""
    parts = re.split(r"[^0-9A-Za-z]+", enum_name)
    return "".join(p[:1].upper() + p[1:] for p in parts if p)


def member_name(value: str) -> str:
    """"LVAIGS (5%)" -> "LVAIGS_5"; "n/a" -> "N_A"."""
    name = re.sub(r"[^0-9A-Za-z]+", "_", value.upper()).strip("_")
    if name[:1].isdigit():
        name = "V_" + name
    return name


def enum_for_field(field_name: str, enum_names: set[str]) -> str | None:
    if field_name in ENUM_ALIASES:
        return ENUM_ALIASES[field_name]
    if field_name in enum_names:
        return field_name
    return None


def render_types(schema: dict[str, Any]) -> str:
    enum_names = {e["enumeration"] for e in schema["enumerations"]}
    out: list[str] = []
    out.append(f'"""{HEADER}\n')
    out.append("TypedDicts mirror the entity sheets field-for-field (snake_case data_element")
    out.append("names). Decimal/Percent fields are exact decimal STRINGS; never floats.")
    out.append('"""\n')
    out.append("from __future__ import annotations\n")
    out.append("from enum import Enum")
    out.append("from typing import NotRequired, TypedDict\n")
    out.append(f'SCHEMA_SHA256 = "{schema_sha256()}"\n')

    # ---- Enum classes (one per enumeration; V-R2 validates against these) ----
    for e in schema["enumerations"]:
        cname = enum_class_name(e["enumeration"])
        out.append(f"class {cname}(str, Enum):")
        out.append(f'    """Enumeration "{e["enumeration"]}" (used in: {e["used_in"]})."""\n')
        for v in e["allowed_values"]:
            out.append(f'    {member_name(v)} = "{v}"')
        out.append("\n")

    out.append("# enumeration name -> allowed values (V-R2)")
    out.append("ENUM_VALUES: dict[str, tuple[str, ...]] = {")
    for e in schema["enumerations"]:
        vals = ", ".join(f'"{v}"' for v in e["allowed_values"])
        out.append(f'    "{e["enumeration"]}": ({vals},),')
    out.append("}\n")

    out.append("# enumeration name -> Enum class")
    out.append("ENUMS: dict[str, type[Enum]] = {")
    for e in schema["enumerations"]:
        out.append(f'    "{e["enumeration"]}": {enum_class_name(e["enumeration"])},')
    out.append("}\n")

    # ---- TypedDicts per entity sheet ----
    for ent in schema["entities"]:
        cname = class_name(ent["sheet"])
        out.append(f"class {cname}(TypedDict):")
        out.append(f'    """{ent["sheet"]} — {ent["title"]}."""\n')
        for f in ent["fields"]:
            py = PY_TYPES[f["data_type"]]
            ann = py if f["required"] == "Mandatory" else f"NotRequired[{py}]"
            enum = enum_for_field(f["data_element"], enum_names) if f["data_type"] == "Enum" else None
            comment = f"  # enum: {enum}" if enum else ""
            out.append(f'    {f["data_element"]}: {ann}{comment}')
        out.append("\n")

    # ---- Metadata driving validation (V-R1/V-R2) and persistence ----
    out.append("# sheet -> {class_name, table, primary_key, field_order, fields}")
    out.append("# fields: name -> {type, py, required, enum, references}")
    out.append("ENTITIES: dict[str, dict] = {")
    for ent in schema["entities"]:
        sheet = ent["sheet"]
        pk = next(f["data_element"] for f in ent["fields"] if f.get("primary_key"))
        table = TABLES.get(sheet)
        out.append(f'    "{sheet}": {{')
        out.append(f'        "class_name": "{class_name(sheet)}",')
        out.append(f'        "table": {table!r},')
        out.append(f'        "primary_key": "{pk}",')
        order = ", ".join(f'"{f["data_element"]}"' for f in ent["fields"])
        out.append(f'        "field_order": ({order},),')
        out.append('        "fields": {')
        for f in ent["fields"]:
            enum = enum_for_field(f["data_element"], enum_names) if f["data_type"] == "Enum" else None
            ref = f.get("references")
            ref_lit = f'("{ref["entity"]}", "{ref["field"]}")' if ref else "None"
            out.append(
                f'            "{f["data_element"]}": {{"type": "{f["data_type"]}", '
                f'"py": "{PY_TYPES[f["data_type"]]}", "required": "{f["required"]}", '
                f'"enum": {enum!r}, "references": {ref_lit}}},'
            )
        out.append("        },")
        out.append("    },")
    out.append("}\n")

    ledgers = ", ".join(f'"{s}"' for s in TABLES)
    out.append("# Append-only ledger sheets (corrections = reversing rows, never UPDATE)")
    out.append(f"LEDGER_SHEETS: tuple[str, ...] = ({ledgers},)\n")
    out.append("# sheet -> SQLite table (engine-persisted sheets only; the rest are seeds)")
    out.append("TABLES: dict[str, str] = {")
    for sheet, table in TABLES.items():
        out.append(f'    "{sheet}": "{table}",')
    out.append("}")
    return "\n".join(out) + "\n"


def _render_table(ent: dict[str, Any], extra_cols: list[str]) -> list[str]:
    sheet = ent["sheet"]
    table = TABLES[sheet]
    lines = [
        f"-- {sheet} ({ent['title']}) -> {table}. Append-only ledger:",
        "-- corrections are reversing rows, never UPDATEs (SPEC §3.1).",
        f"CREATE TABLE IF NOT EXISTS {table} (",
    ]
    cols: list[str] = []
    for f in ent["fields"]:
        col = f"  {f['data_element']} {SQL_TYPES[f['data_type']]}"
        if f.get("primary_key"):
            col += " PRIMARY KEY"
        elif f["required"] == "Mandatory":
            col += " NOT NULL"
        if f["data_type"] == "Boolean":
            col += f" CHECK ({f['data_element']} IN (0, 1))"
        cols.append(col)
    cols.extend(f"  {c}" for c in extra_cols)
    lines.append(",\n".join(cols))
    lines.append(");")
    return lines


def render_ddl_body(schema: dict[str, Any]) -> str:
    """The DDL statements (no file header) — also spliced into state/schema.sql."""
    by_sheet = {e["sheet"]: e for e in schema["entities"]}
    out: list[str] = []
    out.append("-- Allocation engine ledgers (docs/allocation/SPEC.md §3). Decimal/Percent")
    out.append("-- columns are TEXT holding exact decimal strings — never floats.")
    out.append("")
    out.extend(_render_table(by_sheet["1_CostLine"], []))
    out.append("")
    out.extend(_render_table(by_sheet["7_KeyValue"], []))
    out.append("")
    # SPEC §3.2: extend 10_ChargeLedger with run_id (engine-written rows are
    # run-scoped); 11_Recon already carries run_id in the schema.
    out.extend(_render_table(by_sheet["10_ChargeLedger"], ["run_id TEXT"]))
    out.append("")
    out.extend(_render_table(by_sheet["11_Recon"], []))
    out.append("")
    out.append("-- Run table (SPEC §3.2): period, scope, engine/schema versions, input")
    out.append("-- snapshot hash, timing, status. Config (SPEC §6) persisted with the run.")
    out.append("CREATE TABLE IF NOT EXISTS allocation_runs (")
    out.append("  run_id              TEXT PRIMARY KEY,")
    out.append("  period              TEXT NOT NULL,")
    out.append("  run_type            TEXT NOT NULL CHECK (run_type IN ('budget', 'actual', 'trueup')),")
    out.append("  scope_json          TEXT,")
    out.append("  config_json         TEXT,")
    out.append("  engine_version      TEXT,")
    out.append("  schema_version      TEXT,")
    out.append("  input_snapshot_hash TEXT,")
    out.append("  started_at          TEXT NOT NULL,")
    out.append("  finished_at         TEXT,")
    out.append("  status              TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed'))")
    out.append(");")
    out.append("")
    out.append("CREATE INDEX IF NOT EXISTS ix_cost_lines_provider_period ON cost_lines (provider_entity_id, fiscal_period);")
    out.append("CREATE INDEX IF NOT EXISTS ix_cost_lines_pool ON cost_lines (pool_id);")
    out.append("CREATE INDEX IF NOT EXISTS ix_key_values_pool_period ON key_values (pool_id, period);")
    out.append("CREATE INDEX IF NOT EXISTS ix_charge_ledger_run ON charge_ledger (run_id);")
    out.append("CREATE INDEX IF NOT EXISTS ix_charge_ledger_pool_period ON charge_ledger (pool_id, period);")
    out.append("CREATE INDEX IF NOT EXISTS ix_recon_run ON recon (run_id);")
    return "\n".join(out) + "\n"


def render_ddl(schema: dict[str, Any]) -> str:
    return f"-- {HEADER}\n\n" + render_ddl_body(schema)


def render_init() -> str:
    return f'"""{HEADER}"""\n'


def splice_schema_sql(existing: str, ddl_body: str) -> str:
    """Insert/replace the generated DDL between markers in state/schema.sql."""
    block = f"{BEGIN_MARK}\n{ddl_body}{END_MARK}\n"
    if BEGIN_MARK in existing:
        pre = existing.split(BEGIN_MARK)[0]
        post = existing.split(END_MARK, 1)[1].lstrip("\n")
        if post:
            post = "\n" + post
        return pre + block + post
    return existing.rstrip("\n") + "\n\n" + block


def main() -> None:
    schema = load_schema()
    GENERATED_DIR.mkdir(exist_ok=True)
    (GENERATED_DIR / "__init__.py").write_text(render_init(), encoding="utf-8")
    (GENERATED_DIR / "types.py").write_text(render_types(schema), encoding="utf-8")
    (GENERATED_DIR / "ddl.sql").write_text(render_ddl(schema), encoding="utf-8")
    SCHEMA_SQL_PATH.write_text(
        splice_schema_sql(SCHEMA_SQL_PATH.read_text(encoding="utf-8"), render_ddl_body(schema)),
        encoding="utf-8",
    )
    print(f"generated: {GENERATED_DIR / 'types.py'}")
    print(f"generated: {GENERATED_DIR / 'ddl.sql'}")
    print(f"spliced:   {SCHEMA_SQL_PATH}")


if __name__ == "__main__":
    main()
