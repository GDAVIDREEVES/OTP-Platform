"""Schema-level row validation, driven entirely by the GENERATED metadata.

Pure functions (no I/O). Entity shapes are never hand-written here — every
check reads ``allocation.generated.types.ENTITIES``, which codegen renders from
docs/allocation/intercompany-allocation-schema.json.

Rules covered at this level (SPEC §7 "Referential & schema"):
- V-R1 BLOCK — every FK in schema.json ``references`` must resolve (checked
  when a ref index is supplied; persistence has no constraints by design).
- V-R2 BLOCK — enum fields validate against the schema ``enumerations``.

Plus the serialization conventions (DECISIONS.md): Decimal/Percent values are
exact decimal STRINGS (floats are rejected outright — ENGINE-CLAUDE.md "No
float math on money"); Date is ISO ``YYYY-MM-DD``; Boolean is a JSON bool;
Integer is an int (bools rejected).

The stage-level rule catalogue (V-P*, V-B*, V-K*, V-M*, V-C*, V-X*) lands with
the stages in M2+ — this module is only the schema gate beneath it.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping

from allocation.generated import types as gen

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

RefIndex = dict[tuple[str, str], set[Any]]


def _check_value(sheet: str, field: str, meta: Mapping[str, Any], value: Any) -> str | None:
    """Type/enum check for one present, non-None value. Returns an error or None."""
    kind = meta["type"]
    if kind == "Boolean":
        if not isinstance(value, bool):
            return f"{sheet}.{field}: expected bool, got {type(value).__name__}"
        return None
    if kind == "Integer":
        if isinstance(value, bool) or not isinstance(value, int):
            return f"{sheet}.{field}: expected int, got {type(value).__name__}"
        return None
    # Everything else is serialized as str.
    if isinstance(value, float):
        # Floats on amounts (or anywhere) are forbidden by design.
        return f"{sheet}.{field}: float values are forbidden (use exact decimal strings)"
    if not isinstance(value, str):
        return f"{sheet}.{field}: expected str, got {type(value).__name__}"
    if kind in ("Decimal", "Percent"):
        try:
            Decimal(value)
        except InvalidOperation:
            return f"{sheet}.{field}: not a valid decimal string: {value!r}"
    elif kind == "Date":
        if not _DATE_RE.match(value):
            return f"{sheet}.{field}: not an ISO date (YYYY-MM-DD): {value!r}"
    elif kind == "Enum":
        enum = meta["enum"]
        # 6_KeyDef.recompute_frequency has no enumeration entry in schema.json
        # — validated as free text (DECISIONS.md).
        if enum is not None and value not in gen.ENUM_VALUES[enum]:  # V-R2
            return f"{sheet}.{field}: {value!r} not in enumeration {enum!r}"
    return None


def validate_row(sheet: str, row: Mapping[str, Any], refs: RefIndex | None = None) -> list[str]:
    """Validate one row against the generated metadata. ``refs`` enables V-R1."""
    ent = gen.ENTITIES[sheet]
    fields = ent["fields"]
    errors: list[str] = []
    for k in row:
        if k not in fields:
            errors.append(f"{sheet}: unknown field {k!r}")
    for name, meta in fields.items():
        present = name in row and row[name] is not None
        if meta["required"] == "Mandatory" and not present:
            errors.append(f"{sheet}.{name}: mandatory field missing")
            continue
        if not present:
            continue
        err = _check_value(sheet, name, meta, row[name])
        if err:
            errors.append(err)
            continue
        ref = meta["references"]
        if ref is not None and refs is not None:  # V-R1
            target = refs.get((ref[0], ref[1]), set())
            if row[name] not in target:
                errors.append(
                    f"{sheet}.{name}: FK {row[name]!r} does not resolve to {ref[0]}.{ref[1]}"
                )
    return errors


def validate_rows(
    sheet: str, rows: Iterable[Mapping[str, Any]], refs: RefIndex | None = None
) -> list[str]:
    errors: list[str] = []
    for i, row in enumerate(rows):
        errors.extend(f"[{i}] {e}" for e in validate_row(sheet, row, refs))
    return errors


def build_ref_index(rows_by_sheet: Mapping[str, Iterable[Mapping[str, Any]]]) -> RefIndex:
    """Collect every FK target value set referenced anywhere in the schema.

    ``rows_by_sheet`` maps sheet name (e.g. "8_Entity") to its rows; targets
    whose sheet is absent simply yield empty sets (their FKs then fail V-R1,
    which is the conservative default).
    """
    targets: set[tuple[str, str]] = set()
    for ent in gen.ENTITIES.values():
        for meta in ent["fields"].values():
            if meta["references"] is not None:
                targets.add((meta["references"][0], meta["references"][1]))
    refs: RefIndex = {t: set() for t in targets}
    for (t_sheet, t_field) in targets:
        for row in rows_by_sheet.get(t_sheet, ()):  # type: ignore[arg-type]
            v = row.get(t_field)
            if v is not None:
                refs[(t_sheet, t_field)].add(v)
    return refs
