"""Dataset / data-prep compiler (Phase 8 DS1).

A *dataset* is a small data-flow graph — ``source / filter / aggregate / join /
union / derive / select`` nodes — that compiles to **one safe parameterized
DuckDB query** (a CTE chain) run through ``db.q(sql, params)``. There is **no new
data engine**: DuckDB stays the engine exactly as ``calc/warehouse.aggregate``
builds GROUP-BY ``SUM`` queries today. This module is the data-prep generalization
of the ``calc/expr.py:MEASURE_TABLES`` injection-safety discipline:

* **Every table/column/operator/join-key name comes ONLY from the allowlist
  registry** (:data:`DATASET_TABLES`). A node referencing an unknown source,
  column, op or key raises a precise :class:`DatasetError` at *validate* time —
  no SQL is ever emitted for it (test-enforced). No silent defaults.
* **Every value is a BOUND query parameter** — filter literals, ``IN`` lists and
  ``BETWEEN`` bounds are appended to a ``params`` list and bound by DuckDB; they
  are never interpolated into the SQL string. So a dataset graph can never inject
  SQL even though its author controls the predicate values.
* **Money stays Decimal** — the journal/segment_pl/cost_line amount columns are
  DuckDB ``DECIMAL``; ``SUM`` over them returns Python :class:`decimal.Decimal`,
  so a compiled aggregate ties out to a hand query to the cent.

The sources are the four real warehouse DuckDB views (``journal`` exposes a
curated, generous ACDOCA subset — dimensions + meaningful measures, NOT every
SAP column) plus the **fabricated** allocation ``cost_lines`` seed, materialized
into a queryable DuckDB relation here (provenance flagged ``fabricated``). The
``journal`` source is registered under the logical name ``journal_entries`` and
``supply_chain`` under ``supply_chain_flows`` (the spec's logical source names);
the physical DuckDB view name is carried in each entry's ``view``.

Compiler entry points:

* :func:`validate_dataset` — structural validation (acyclic; single terminal;
  columns / ops / keys / measures all allowlisted; union schemas compatible).
  Returns ``{ok, errors, output_columns}``; never raises for a graph problem.
* :func:`compile_dataset` — graph -> ``(sql, params, output_columns)``. Raises
  :class:`DatasetError` on an invalid graph (call ``validate_dataset`` first for
  the full error list).
* :func:`run_dataset` — compile + run via ``db.q`` -> ``{columns, rows, row_count}``
  (rows sample-capped; ``row_count`` is the true total via a ``COUNT(*)`` wrap).
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Sequence

import state.seeds as seeds
from db import db, q

# --------------------------------------------------------------------------- #
# Errors
# --------------------------------------------------------------------------- #


class DatasetError(ValueError):
    """A dataset graph problem, optionally pointing at the offending node id."""

    def __init__(self, message: str, node_id: str | None = None):
        super().__init__(message)
        self.message = message
        self.node_id = node_id


# --------------------------------------------------------------------------- #
# Source registry (the allowlist) — generalizes expr.MEASURE_TABLES
# --------------------------------------------------------------------------- #
# Each entry:
#   view:        physical DuckDB relation name (db._VIEWS / the materialized rel)
#   provenance:  "real" (warehouse parquet) | "fabricated" (the cost_lines seed)
#   columns:     name -> {"role": "dimension"|"measure", "type": <sql type>}
#   join_keys:   columns usable as join keys (subset of columns)
#   dimensions:  columns whose distinct values the palette may enumerate
#   measures:    derived = [c for c, m in columns if m["role"] == "measure"]
# Column names here are the ONLY identifiers the compiler will emit — values are
# always bound. Adding a column here is the one place to widen the surface.

_DIM = "dimension"
_MEAS = "measure"

DATASET_TABLES: dict[str, dict[str, Any]] = {
    # The journal — a curated, generous, REAL ACDOCA subset. Dimensions the user
    # asked for (GL account RACCT, cost center RCNTR, profit center PRCTR, …)
    # plus the meaningful amount measures (HSL company-code currency is the
    # money column the whole platform sums; KSL/OSL are the parallel ledgers)
    # and a few doc/currency fields. NOT the hundreds of mostly-null SAP columns.
    "journal_entries": {
        "view": "journal",
        "provenance": "real",
        "catalog_id": "warehouse:journal_entries",
        "label": "Journal (ACDOCA)",
        "columns": {
            # dimensions
            "RBUKRS": {"role": _DIM, "type": "VARCHAR"},   # company code (entity)
            "RACCT": {"role": _DIM, "type": "VARCHAR"},     # G/L account
            "RCNTR": {"role": _DIM, "type": "VARCHAR"},     # cost center
            "PRCTR": {"role": _DIM, "type": "VARCHAR"},     # profit center
            "GJAHR": {"role": _DIM, "type": "BIGINT"},      # fiscal year
            "POPER": {"role": _DIM, "type": "VARCHAR"},     # posting period
            "SEGMENT": {"role": _DIM, "type": "VARCHAR"},   # segment
            "BLART": {"role": _DIM, "type": "VARCHAR"},     # document type
            "DRCRK": {"role": _DIM, "type": "VARCHAR"},     # debit/credit indicator
            "RHCUR": {"role": _DIM, "type": "VARCHAR"},     # company-code currency
            "BUDAT": {"role": _DIM, "type": "DATE"},        # posting date
            "BELNR": {"role": _DIM, "type": "VARCHAR"},     # document number
            "SGTXT": {"role": _DIM, "type": "VARCHAR"},     # line item text
            # measures (DuckDB DECIMAL(23,2) -> Decimal on SUM)
            "HSL": {"role": _MEAS, "type": "DECIMAL(23,2)"},  # company-code amount
            "KSL": {"role": _MEAS, "type": "DECIMAL(23,2)"},  # parallel ledger amount
            "OSL": {"role": _MEAS, "type": "DECIMAL(23,2)"},  # parallel ledger amount
        },
        "join_keys": ("RBUKRS", "RACCT", "RCNTR", "PRCTR", "SEGMENT", "GJAHR"),
        "dimensions": ("RBUKRS", "RACCT", "RCNTR", "PRCTR", "GJAHR", "POPER",
                       "SEGMENT", "BLART", "DRCRK"),
    },
    # Entity P&L (pre-aggregated, real) — the segment_pl warehouse view.
    "segment_pl": {
        "view": "segment_pl",
        "provenance": "real",
        "catalog_id": "warehouse:segment_pl",
        "label": "Segmented P&L",
        "columns": {
            "RBUKRS": {"role": _DIM, "type": "VARCHAR"},
            "ROLE_CODE": {"role": _DIM, "type": "VARCHAR"},
            "SEGMENT": {"role": _DIM, "type": "VARCHAR"},
            "GJAHR": {"role": _DIM, "type": "BIGINT"},
            "POPER": {"role": _DIM, "type": "VARCHAR"},
            "revenue": {"role": _MEAS, "type": "DECIMAL(23,2)"},
            "other_income": {"role": _MEAS, "type": "DECIMAL(23,2)"},
            "cogs": {"role": _MEAS, "type": "DECIMAL(23,2)"},
            "opex_production": {"role": _MEAS, "type": "DECIMAL(23,2)"},
            "opex_rd": {"role": _MEAS, "type": "DECIMAL(23,2)"},
            "opex_sm": {"role": _MEAS, "type": "DECIMAL(23,2)"},
            "opex_ga": {"role": _MEAS, "type": "DECIMAL(23,2)"},
            "opex_dist": {"role": _MEAS, "type": "DECIMAL(23,2)"},
            "ic_charges": {"role": _MEAS, "type": "DECIMAL(23,2)"},
            "depreciation": {"role": _MEAS, "type": "DECIMAL(23,2)"},
            "operating_profit": {"role": _MEAS, "type": "DECIMAL(23,2)"},
        },
        "join_keys": ("RBUKRS", "ROLE_CODE", "SEGMENT", "GJAHR"),
        "dimensions": ("RBUKRS", "ROLE_CODE", "SEGMENT", "GJAHR", "POPER"),
    },
    # Supply-chain flows (real) — the supply_chain warehouse view.
    "supply_chain_flows": {
        "view": "supply_chain",
        "provenance": "real",
        "catalog_id": "warehouse:supply_chain_flows",
        "label": "Supply-chain flows",
        "columns": {
            "CHAIN_ID": {"role": _DIM, "type": "VARCHAR"},
            "STEP_NUMBER": {"role": _DIM, "type": "BIGINT"},
            "MATERIAL_TYPE": {"role": _DIM, "type": "VARCHAR"},
            "SELLING_COMPANY": {"role": _DIM, "type": "VARCHAR"},
            "BUYING_COMPANY": {"role": _DIM, "type": "VARCHAR"},
            "TP_METHOD": {"role": _DIM, "type": "VARCHAR"},
            "SELLER_ROLE": {"role": _DIM, "type": "VARCHAR"},
            "BUYER_ROLE": {"role": _DIM, "type": "VARCHAR"},
            "GJAHR": {"role": _DIM, "type": "BIGINT"},
            "POPER": {"role": _DIM, "type": "VARCHAR"},
            "STANDARD_COST": {"role": _MEAS, "type": "DECIMAL(23,4)"},
            "MARKUP_RATE": {"role": _MEAS, "type": "DECIMAL(18,6)"},
            "TOTAL_LEGAL_PRICE": {"role": _MEAS, "type": "DECIMAL(23,2)"},
        },
        "join_keys": ("CHAIN_ID", "SELLING_COMPANY", "BUYING_COMPANY", "GJAHR"),
        "dimensions": ("MATERIAL_TYPE", "TP_METHOD", "SELLER_ROLE", "BUYER_ROLE",
                       "GJAHR", "POPER"),
    },
    # Entity roles / characterization (real) — the entity_roles warehouse view.
    "entity_roles": {
        "view": "entity_roles",
        "provenance": "real",
        "catalog_id": "warehouse:entity_roles",
        "label": "Entity roles",
        "columns": {
            "RBUKRS": {"role": _DIM, "type": "VARCHAR"},
            "LAND1": {"role": _DIM, "type": "VARCHAR"},
            "ROLE_CODE": {"role": _DIM, "type": "VARCHAR"},
            "ROLE_DESCRIPTION": {"role": _DIM, "type": "VARCHAR"},
        },
        "join_keys": ("RBUKRS", "ROLE_CODE", "LAND1"),
        "dimensions": ("RBUKRS", "LAND1", "ROLE_CODE"),
    },
    # Allocation cost lines (FABRICATED seed) — materialized into a DuckDB
    # relation here so the dataset compiler can query it like any source. This is
    # the fine, function-realistic cost-center grain beneath reconciled totals
    # (provenance fabricated — clearly distinct from the real coarse ACDOCA CCs).
    "allocation_cost_lines": {
        "view": "allocation_cost_lines",
        "provenance": "fabricated",
        "catalog_id": "seed:allocation_cost_lines",
        "label": "Allocation cost lines (fabricated)",
        "columns": {
            "cost_line_id": {"role": _DIM, "type": "VARCHAR"},
            "provider_entity_id": {"role": _DIM, "type": "VARCHAR"},
            "company_code": {"role": _DIM, "type": "VARCHAR"},
            "cost_center": {"role": _DIM, "type": "VARCHAR"},
            "profit_center": {"role": _DIM, "type": "VARCHAR"},
            "cost_element": {"role": _DIM, "type": "VARCHAR"},
            "cost_nature": {"role": _DIM, "type": "VARCHAR"},
            "function": {"role": _DIM, "type": "VARCHAR"},
            "currency_local": {"role": _DIM, "type": "VARCHAR"},
            "fiscal_period": {"role": _DIM, "type": "VARCHAR"},
            "fiscal_year": {"role": _DIM, "type": "VARCHAR"},
            "flow_type": {"role": _DIM, "type": "VARCHAR"},
            "charge_method": {"role": _DIM, "type": "VARCHAR"},
            "ledger": {"role": _DIM, "type": "VARCHAR"},  # 'actual' | 'budget'
            "amount_local": {"role": _MEAS, "type": "DECIMAL(23,2)"},
        },
        "join_keys": ("provider_entity_id", "company_code", "cost_center",
                      "profit_center", "fiscal_period"),
        "dimensions": ("provider_entity_id", "cost_center", "profit_center",
                       "cost_element", "function", "fiscal_period", "ledger"),
    },
}


def _measures(spec: dict[str, Any]) -> tuple[str, ...]:
    return tuple(c for c, m in spec["columns"].items() if m["role"] == _MEAS)


# --------------------------------------------------------------------------- #
# allocation_cost_lines — materialize the fabricated seed into a DuckDB relation
# --------------------------------------------------------------------------- #
# The cost_lines source is a SEED (backend/seeds/allocation/cost_lines.v1.json),
# not a parquet view, so we register an in-memory DuckDB table the compiler can
# SELECT from. The ``ledger`` column tags each row 'actual' | 'budget' (the seed
# splits them). Idempotent: CREATE OR REPLACE, so it tracks the live seed.

_COST_LINE_REL = "allocation_cost_lines"
_cost_lines_ready = False


def _cost_line_rows() -> list[dict[str, Any]]:
    seed = seeds.load("allocation_cost_lines")
    cols = list(DATASET_TABLES["allocation_cost_lines"]["columns"])
    rows: list[dict[str, Any]] = []
    for ledger in ("actual", "budget"):
        for r in seed.get(ledger, []):
            row = {c: r.get(c) for c in cols if c != "ledger"}
            row["ledger"] = ledger
            rows.append(row)
    return rows


def ensure_cost_lines_relation(force: bool = False) -> None:
    """Materialize the fabricated cost_lines seed into a typed DuckDB table so
    the dataset compiler can query it. ``amount_local`` is cast to DECIMAL(23,2)
    so SUM stays Decimal (money exact); idempotent unless ``force``."""
    global _cost_lines_ready
    if _cost_lines_ready and not force:
        return
    spec = DATASET_TABLES["allocation_cost_lines"]
    coldefs = ", ".join(f'"{c}" {m["type"]}' for c, m in spec["columns"].items())
    cols = list(spec["columns"])
    con = db()
    con.execute(f"DROP TABLE IF EXISTS {_COST_LINE_REL}")
    con.execute(f"CREATE TABLE {_COST_LINE_REL} ({coldefs})")
    rows = _cost_line_rows()
    if rows:
        placeholders = ", ".join("?" for _ in cols)
        con.executemany(
            f"INSERT INTO {_COST_LINE_REL} ({', '.join(cols)}) VALUES ({placeholders})",
            [[r.get(c) for c in cols] for r in rows],
        )
    _cost_lines_ready = True


# --------------------------------------------------------------------------- #
# Operators / aggregate functions (the only ones the compiler will emit)
# --------------------------------------------------------------------------- #

_FILTER_OPS = {"=", "!=", "<", ">", "<=", ">=", "IN", "BETWEEN", "LIKE"}
_AGG_FUNCS = {"SUM", "COUNT", "AVG", "MIN", "MAX"}
# Safe arithmetic for derive nodes — the operator -> SQL symbol map.
_ARITH_OPS = {"+": "+", "-": "-", "*": "*", "/": "/"}


# --------------------------------------------------------------------------- #
# Graph helpers
# --------------------------------------------------------------------------- #


def _nodes(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for n in graph.get("nodes", []):
        nid = n.get("id")
        if not nid:
            raise DatasetError("every node needs an id")
        if nid in out:
            raise DatasetError(f"duplicate node id {nid!r}", nid)
        out[nid] = n
    return out


def _inputs(graph: dict[str, Any]) -> dict[str, list[str]]:
    """node id -> ordered list of upstream (source) node ids, from edges. An
    edge is ``{source, target}`` (relation flows source -> target). Order
    follows edge declaration order, which the binary nodes (join/union) rely on
    for left/right."""
    ins: dict[str, list[str]] = {n["id"]: [] for n in graph.get("nodes", [])}
    for e in graph.get("edges", []):
        src, tgt = e.get("source"), e.get("target")
        if src is None or tgt is None:
            raise DatasetError("every edge needs source and target")
        if tgt not in ins:
            raise DatasetError(f"edge target {tgt!r} is not a node")
        if src not in ins:
            raise DatasetError(f"edge source {src!r} is not a node")
        ins[tgt].append(src)
    return ins


def _topo_order(node_ids: Sequence[str], ins: dict[str, list[str]]) -> list[str]:
    """Kahn topological sort; raises on a cycle (acyclicity is a hard rule)."""
    indeg = {nid: len(ins[nid]) for nid in node_ids}
    outs: dict[str, list[str]] = {nid: [] for nid in node_ids}
    for nid in node_ids:
        for src in ins[nid]:
            outs[src].append(nid)
    queue = [nid for nid in node_ids if indeg[nid] == 0]
    order: list[str] = []
    while queue:
        nid = queue.pop(0)
        order.append(nid)
        for nxt in outs[nid]:
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                queue.append(nxt)
    if len(order) != len(node_ids):
        raise DatasetError("dataset graph has a cycle")
    return order


def _terminal(node_ids: Sequence[str], ins: dict[str, list[str]]) -> str:
    """The single node no other node consumes (the dataset's output relation)."""
    consumed = {src for srcs in ins.values() for src in srcs}
    terminals = [nid for nid in node_ids if nid not in consumed]
    if not terminals:
        raise DatasetError("dataset graph has no terminal output node")
    if len(terminals) > 1:
        raise DatasetError(
            f"dataset graph has {len(terminals)} terminal nodes "
            f"({', '.join(sorted(terminals))}) — exactly one output is required")
    return terminals[0]


# --------------------------------------------------------------------------- #
# Per-node SQL builders. Each returns (cte_body_sql, output_columns, params) for
# the node, given its already-compiled upstream CTE names + their schemas.
# Column identifiers are emitted verbatim ONLY after allowlist checks; every
# literal value is appended to ``params`` (bound), never interpolated.
# --------------------------------------------------------------------------- #


def _check_cols(cols: Sequence[str], available: Sequence[str], nid: str,
                what: str) -> None:
    avail = set(available)
    for c in cols:
        if c not in avail:
            raise DatasetError(
                f"{what} {c!r} is not a column of this relation "
                f"(available: {', '.join(available)})", nid)


#: ``source`` node config ``table`` value naming an authored dataset source:
#: ``dataset/{id}`` (DS2). The active dataset's compiled query is inlined as a
#: subquery — the dataset bridge (a dataset referencing another dataset).
_DATASET_SOURCE_PREFIX = "dataset/"


def _resolve_dataset_source(table: str) -> tuple[dict[str, Any], str]:
    """Resolve a ``dataset/{id}`` source ``table`` to the ACTIVE authored
    dataset's graph + id, deferring the import of ``state.authored_datasets`` to
    keep that lifecycle module off this compiler's import path. Raises
    :class:`DatasetError` if the id is unknown or the dataset is not active (a
    draft/tested/in_review dataset can never be referenced — no silent default)."""
    dataset_id = table[len(_DATASET_SOURCE_PREFIX):]
    if not dataset_id:
        raise DatasetError(
            "dataset source needs an id (use 'dataset/{id}')")
    import state.authored_datasets as authored_datasets  # deferred: avoid cycle
    record = authored_datasets.get_authored_dataset(dataset_id)
    if record is None:
        raise DatasetError(f"unknown dataset source {dataset_id!r}")
    if record["status"] != "active":
        raise DatasetError(
            f"dataset {dataset_id!r} is {record['status']} — only an ACTIVE "
            "authored dataset can be referenced as a source")
    return record["graph"], dataset_id


def _build_source(node: dict[str, Any], compiling: tuple[str, ...]
                  ) -> tuple[str, list[str], list[Any]]:
    cfg = node.get("config") or {}
    table = cfg.get("table") or node.get("table")
    if isinstance(table, str) and table.startswith(_DATASET_SOURCE_PREFIX):
        # An authored dataset referenced as a source — inline its compiled query
        # as a subquery (cycle-guarded through ``compiling``).
        graph, dataset_id = _resolve_dataset_source(table)
        if dataset_id in compiling:
            chain = " -> ".join(compiling + (dataset_id,))
            raise DatasetError(
                f"dataset reference cycle: {chain}", node["id"])
        try:
            sub_sql, sub_params, sub_cols = _compile(
                graph, compiling=compiling + (dataset_id,))
        except DatasetError as e:
            raise DatasetError(
                f"dataset source {dataset_id!r} failed to compile: {e.message}",
                node["id"])
        requested = cfg.get("columns")
        if requested:
            _check_cols(requested, sub_cols, node["id"], "source column")
            out_cols = list(requested)
        else:
            out_cols = list(sub_cols)
        select = ", ".join(f'"{c}"' for c in out_cols)
        sql = f"SELECT {select} FROM (\n{sub_sql}\n) _src"
        return sql, out_cols, sub_params
    if table not in DATASET_TABLES:
        raise DatasetError(
            f"unknown source table {table!r} "
            f"(known: {', '.join(sorted(DATASET_TABLES))})", node["id"])
    spec = DATASET_TABLES[table]
    requested = cfg.get("columns")
    available = list(spec["columns"])
    if requested:
        _check_cols(requested, available, node["id"], "source column")
        out_cols = list(requested)
    else:
        out_cols = available
    select = ", ".join(f'"{c}"' for c in out_cols)
    sql = f"SELECT {select} FROM {spec['view']}"
    return sql, out_cols, []


def _build_filter(node: dict[str, Any], up_cols: list[str]
                  ) -> tuple[str, list[str], list[Any]]:
    cfg = node.get("config") or {}
    predicates = cfg.get("predicates") or cfg.get("filters") or []
    if not predicates:
        raise DatasetError("filter node needs at least one predicate", node["id"])
    clauses: list[str] = []
    params: list[Any] = []
    for p in predicates:
        col, op = p.get("column"), p.get("op")
        _check_cols([col], up_cols, node["id"], "filter column")
        if op not in _FILTER_OPS:
            raise DatasetError(
                f"filter op {op!r} is not allowed "
                f"(allowed: {', '.join(sorted(_FILTER_OPS))})", node["id"])
        if op == "IN":
            vals = p.get("values")
            if not isinstance(vals, (list, tuple)) or not vals:
                raise DatasetError(
                    "filter op IN needs a non-empty 'values' list", node["id"])
            placeholders = ", ".join("?" for _ in vals)
            clauses.append(f'"{col}" IN ({placeholders})')
            params.extend(vals)
        elif op == "BETWEEN":
            lo, hi = p.get("low"), p.get("high")
            if lo is None or hi is None:
                raise DatasetError(
                    "filter op BETWEEN needs 'low' and 'high'", node["id"])
            clauses.append(f'"{col}" BETWEEN ? AND ?')
            params.extend([lo, hi])
        else:
            if "value" not in p:
                raise DatasetError(
                    f"filter op {op} needs a 'value'", node["id"])
            clauses.append(f'"{col}" {op} ?')
            params.append(p["value"])
    sql = f"SELECT * FROM {{up}} WHERE {' AND '.join(clauses)}"
    return sql, list(up_cols), params


def _build_aggregate(node: dict[str, Any], up_cols: list[str]
                     ) -> tuple[str, list[str], list[Any]]:
    cfg = node.get("config") or {}
    group_by = list(cfg.get("group_by") or [])
    measures = cfg.get("measures") or []
    _check_cols(group_by, up_cols, node["id"], "group_by column")
    if not measures:
        raise DatasetError(
            "aggregate node needs at least one measure", node["id"])
    select_parts = [f'"{c}"' for c in group_by]
    out_cols = list(group_by)
    for m in measures:
        col, func = m.get("column"), (m.get("func") or "SUM").upper()
        if func not in _AGG_FUNCS:
            raise DatasetError(
                f"aggregate func {func!r} is not allowed "
                f"(allowed: {', '.join(sorted(_AGG_FUNCS))})", node["id"])
        if func == "COUNT" and (col is None or col == "*"):
            alias = m.get("alias") or "count"
            _check_alias(alias, node["id"])
            select_parts.append(f'COUNT(*) AS "{alias}"')
            out_cols.append(alias)
            continue
        _check_cols([col], up_cols, node["id"], "measure column")
        alias = m.get("alias") or col
        _check_alias(alias, node["id"])
        select_parts.append(f'{func}("{col}") AS "{alias}"')
        out_cols.append(alias)
    sql = f"SELECT {', '.join(select_parts)} FROM {{up}}"
    if group_by:
        sql += " GROUP BY " + ", ".join(f'"{c}"' for c in group_by)
    return sql, out_cols, []


def _build_join(node: dict[str, Any], left_cols: list[str],
                right_cols: list[str]) -> tuple[str, list[str], list[Any]]:
    cfg = node.get("config") or {}
    how = (cfg.get("how") or "INNER").upper()
    if how not in ("INNER", "LEFT"):
        raise DatasetError(
            f"join 'how' must be INNER or LEFT, got {how!r}", node["id"])
    on = cfg.get("on") or []
    if not on:
        raise DatasetError("join node needs at least one 'on' key pair", node["id"])
    conds: list[str] = []
    for pair in on:
        lk, rk = pair.get("left"), pair.get("right")
        _check_cols([lk], left_cols, node["id"], "join left key")
        _check_cols([rk], right_cols, node["id"], "join right key")
        conds.append(f'l."{lk}" = r."{rk}"')
    # Output columns: explicit select, else left + right with right's
    # name-collisions suffixed _r (so the schema is well-defined, no silent drop).
    select = cfg.get("select")
    if select:
        out_parts: list[str] = []
        out_cols: list[str] = []
        for s in select:
            side, col = s.get("side"), s.get("column")
            alias = s.get("alias") or col
            if side == "left":
                _check_cols([col], left_cols, node["id"], "join select column")
                out_parts.append(f'l."{col}" AS "{alias}"')
            elif side == "right":
                _check_cols([col], right_cols, node["id"], "join select column")
                out_parts.append(f'r."{col}" AS "{alias}"')
            else:
                raise DatasetError(
                    f"join select 'side' must be left or right, got {side!r}",
                    node["id"])
            _check_alias(alias, node["id"])
            out_cols.append(alias)
    else:
        out_parts = [f'l."{c}" AS "{c}"' for c in left_cols]
        out_cols = list(left_cols)
        for c in right_cols:
            alias = c if c not in set(left_cols) else f"{c}_r"
            out_parts.append(f'r."{c}" AS "{alias}"')
            out_cols.append(alias)
    sql = (f"SELECT {', '.join(out_parts)} FROM {{left}} l "
           f"{how} JOIN {{right}} r ON {' AND '.join(conds)}")
    return sql, out_cols, []


def _build_union(node: dict[str, Any], left_cols: list[str],
                 right_cols: list[str]) -> tuple[str, list[str], list[Any]]:
    if list(left_cols) != list(right_cols):
        raise DatasetError(
            "union inputs have incompatible schemas: "
            f"[{', '.join(left_cols)}] vs [{', '.join(right_cols)}]", node["id"])
    sql = "SELECT * FROM {left} UNION ALL SELECT * FROM {right}"
    return sql, list(left_cols), []


def _check_alias(alias: str, nid: str) -> None:
    """An output alias must be a plain identifier (letters/digits/underscore) —
    it is emitted verbatim, so it is held to the same allowlist discipline."""
    if not alias or not isinstance(alias, str) or not all(
            ch.isalnum() or ch == "_" for ch in alias) or alias[0].isdigit():
        raise DatasetError(
            f"invalid output name {alias!r} — use letters, digits and "
            "underscores (not starting with a digit)", nid)


def _build_derive(node: dict[str, Any], up_cols: list[str]
                  ) -> tuple[str, list[str], list[Any]]:
    """Add a safe arithmetic computed column: ``alias = left <op> right`` where
    each operand is an allowlisted column OR a numeric constant. Values that are
    constants are BOUND. No free-form SQL."""
    cfg = node.get("config") or {}
    alias = cfg.get("alias")
    _check_alias(alias or "", node["id"])
    left, op, right = cfg.get("left"), cfg.get("op"), cfg.get("right")
    if op not in _ARITH_OPS:
        raise DatasetError(
            f"derive op {op!r} is not allowed (allowed: {', '.join(_ARITH_OPS)})",
            node["id"])
    params: list[Any] = []

    def operand(spec: Any) -> str:
        # {"column": "X"} -> a column reference; {"const": 1.5} -> a bound param.
        # A constant is bound AND cast to DECIMAL so arithmetic over money stays
        # exact (an un-cast '?' makes DuckDB infer DOUBLE and lose Decimal).
        if isinstance(spec, dict) and "column" in spec:
            _check_cols([spec["column"]], up_cols, node["id"], "derive column")
            return f'"{spec["column"]}"'
        if isinstance(spec, dict) and "const" in spec:
            try:
                Decimal(str(spec["const"]))
            except (InvalidOperation, ValueError, TypeError):
                raise DatasetError(
                    f"derive constant {spec['const']!r} is not numeric", node["id"])
            params.append(str(spec["const"]))
            return "CAST(? AS DECIMAL(34,8))"
        raise DatasetError(
            "derive operand must be {'column': ...} or {'const': ...}",
            node["id"])

    # DuckDB decimal division returns DOUBLE (1.1.x semantics) — wrap the whole
    # arithmetic expression in a CAST to DECIMAL so a derived money column stays
    # Decimal-exact (and +,-,* results widen losslessly into the cast scale).
    expr_sql = f"CAST(({operand(left)} {_ARITH_OPS[op]} {operand(right)}) AS DECIMAL(34,8))"
    sql = f'SELECT *, {expr_sql} AS "{alias}" FROM {{up}}'
    return sql, list(up_cols) + [alias], params


def _build_select(node: dict[str, Any], up_cols: list[str]
                  ) -> tuple[str, list[str], list[Any]]:
    cfg = node.get("config") or {}
    columns = cfg.get("columns") or []
    if not columns:
        raise DatasetError("select node needs at least one column", node["id"])
    _check_cols(columns, up_cols, node["id"], "select column")
    sql = "SELECT " + ", ".join(f'"{c}"' for c in columns) + " FROM {up}"
    return sql, list(columns), []


# --------------------------------------------------------------------------- #
# Compiler
# --------------------------------------------------------------------------- #

_UNARY = {"filter", "aggregate", "derive", "select"}
_BINARY = {"join", "union"}
NODE_KINDS = {"source"} | _UNARY | _BINARY

#: The dataset node family for the cockpit palette / node-types catalog (DS2).
#: Each entry declares the node's *relation* handle arity (distinct from the
#: calc value handles + allocation stage handles — ``isValidConnection`` keeps
#: the families separate) and its config keys. The compiler in this module is
#: the single source of truth for the config SHAPE; this catalog mirrors it so
#: the palette can never offer a node the compiler would reject.
DATASET_NODE_TYPES: dict[str, dict[str, Any]] = {
    "source": {"family": "dataset", "inputs": 0, "output": "relation",
               "config": ["table", "columns"]},
    "filter": {"family": "dataset", "inputs": 1, "output": "relation",
               "config": ["predicates"]},
    "aggregate": {"family": "dataset", "inputs": 1, "output": "relation",
                  "config": ["group_by", "measures"]},
    "derive": {"family": "dataset", "inputs": 1, "output": "relation",
               "config": ["alias", "left", "op", "right"]},
    "select": {"family": "dataset", "inputs": 1, "output": "relation",
               "config": ["columns"]},
    "join": {"family": "dataset", "inputs": 2, "output": "relation",
             "config": ["how", "on", "select"]},
    "union": {"family": "dataset", "inputs": 2, "output": "relation",
              "config": []},
}


def dataset_node_types() -> list[dict[str, Any]]:
    """The dataset family node-type schemas (handle arity + config keys + the
    allowed ops/funcs per node), for the palette / node-types catalog. Pure
    read; mirrors the compiler's allowlist (filter ops, aggregate funcs, arith
    ops) so the palette stays in lockstep."""
    out: list[dict[str, Any]] = []
    for typ, spec in DATASET_NODE_TYPES.items():
        entry = {
            "type": typ,
            "family": spec["family"],
            "inputs": spec["inputs"],
            "output": spec["output"],
            "config": list(spec["config"]),
        }
        if typ == "filter":
            entry["ops"] = sorted(_FILTER_OPS)
        elif typ == "aggregate":
            entry["funcs"] = sorted(_AGG_FUNCS)
        elif typ == "derive":
            entry["ops"] = list(_ARITH_OPS)
        elif typ == "join":
            entry["hows"] = ["INNER", "LEFT"]
        out.append(entry)
    return out


def _compile_node(node: dict[str, Any], cte_name: str, ins: list[str],
                  schemas: dict[str, list[str]],
                  compiling: tuple[str, ...] = ()
                  ) -> tuple[str, list[str], list[Any]]:
    """Compile one node into a CTE body, wiring the upstream CTE names in. Each
    node validates its own config against the allowlist; binary nodes consume
    two ordered inputs (left, right). ``compiling`` is the chain of authored
    dataset ids currently being inlined (the cycle-guard for a ``dataset/{id}``
    source)."""
    kind = node.get("type") or node.get("kind")
    if kind not in NODE_KINDS:
        raise DatasetError(
            f"unknown node type {kind!r} (known: {', '.join(sorted(NODE_KINDS))})",
            node.get("id"))
    if kind == "source":
        if ins:
            raise DatasetError("source node takes no inputs", node["id"])
        body, cols, params = _build_source(node, compiling)
    elif kind in _UNARY:
        if len(ins) != 1:
            raise DatasetError(
                f"{kind} node takes exactly one input, got {len(ins)}", node["id"])
        up = schemas[ins[0]]
        builders = {"filter": _build_filter, "aggregate": _build_aggregate,
                    "derive": _build_derive, "select": _build_select}
        body, cols, params = builders[kind](node, up)
        body = body.replace("{up}", ins[0])
    else:  # binary
        if len(ins) != 2:
            raise DatasetError(
                f"{kind} node takes exactly two inputs, got {len(ins)}", node["id"])
        left, right = schemas[ins[0]], schemas[ins[1]]
        if kind == "join":
            body, cols, params = _build_join(node, left, right)
        else:
            body, cols, params = _build_union(node, left, right)
        body = body.replace("{left}", ins[0]).replace("{right}", ins[1])
    return body, cols, params


def _compile(graph: dict[str, Any], compiling: tuple[str, ...] = ()
             ) -> tuple[str, list[Any], list[str]]:
    """Compile one dataset graph to ``(sql, params, output_columns)``, threading
    the ``compiling`` chain of authored-dataset ids so a ``dataset/{id}`` source
    that inlines a sub-graph can detect a reference cycle. CTE names are
    namespaced by depth so an inlined sub-dataset's CTEs never collide with the
    outer graph's."""
    nodes = _nodes(graph)
    if not nodes:
        raise DatasetError("dataset graph has no nodes")
    ins = _inputs(graph)
    order = _topo_order(list(nodes), ins)
    terminal = _terminal(list(nodes), ins)

    ensure_cost_lines_relation()

    depth = len(compiling)

    def cte(nid: str) -> str:
        # node ids may contain '-'; CTE names must be plain identifiers. The
        # depth prefix keeps an inlined sub-dataset's CTEs distinct from the
        # outer graph's (no name collision across nesting).
        safe = "".join(ch if (ch.isalnum() or ch == "_") else "_" for ch in nid)
        return f"n{depth}_{safe}"

    cte_defs: list[str] = []
    params: list[Any] = []
    schemas: dict[str, list[str]] = {}
    for nid in order:
        node = nodes[nid]
        up_ctes = [cte(s) for s in ins[nid]]
        up_schemas = {cte(s): schemas[s] for s in ins[nid]}
        body, cols, node_params = _compile_node(
            node, cte(nid), up_ctes, up_schemas, compiling)
        schemas[nid] = cols
        params.extend(node_params)
        cte_defs.append(f"{cte(nid)} AS (\n  {body}\n)")

    sql = "WITH " + ",\n".join(cte_defs) + f"\nSELECT * FROM {cte(terminal)}"
    return sql, params, schemas[terminal]


def compile_dataset(graph: dict[str, Any]
                    ) -> tuple[str, list[Any], list[str]]:
    """Compile a dataset graph to ``(sql, params, output_columns)``.

    The SQL is a ``WITH`` CTE chain (one CTE per node, named ``n<depth>_<id>``)
    selecting the terminal node's relation. ``params`` are the bound
    filter/derive values in SQL order. A ``dataset/{id}`` source node inlines the
    referenced ACTIVE authored dataset's compiled query as a subquery (cycle-
    guarded). Raises :class:`DatasetError` on any allowlist / structure problem
    (call :func:`validate_dataset` first to collect every error)."""
    return _compile(graph)


def validate_dataset(graph: dict[str, Any]) -> dict[str, Any]:
    """Structural + allowlist validation. Returns
    ``{ok, errors: [{message, node_id}], output_columns}`` — never raises for a
    graph problem (the compiler raises; this collects the first failure cleanly).

    A valid graph: has nodes; is acyclic; has exactly one terminal; every node's
    columns / ops / keys / measures are allowlisted; union schemas are
    compatible. On any failure NO SQL is emitted (the caller can trust an
    ``ok: false`` means nothing was compiled)."""
    try:
        _sql, _params, out_cols = compile_dataset(graph)
    except DatasetError as e:
        return {"ok": False,
                "errors": [{"message": e.message, "node_id": e.node_id}],
                "output_columns": []}
    return {"ok": True, "errors": [], "output_columns": out_cols}


def run_dataset(graph: dict[str, Any], sample_limit: int = 100
                ) -> dict[str, Any]:
    """Compile + run the dataset -> ``{columns, rows, row_count}``.

    ``rows`` is sample-capped at ``sample_limit`` (preview), while ``row_count``
    is the TRUE total via a ``COUNT(*)`` wrap of the same compiled query (one
    extra cheap query — the demo data is small). Money columns come back as
    Decimal (the warehouse/seed amount columns are DuckDB DECIMAL)."""
    sql, params, columns = compile_dataset(graph)
    count_rows = q(f"SELECT COUNT(*) AS n FROM (\n{sql}\n) _ds", list(params))
    row_count = int(count_rows[0]["n"]) if count_rows else 0
    rows = q(f"{sql}\nLIMIT {int(sample_limit)}", list(params))
    return {"columns": columns, "rows": rows, "row_count": row_count}


# --------------------------------------------------------------------------- #
# Source catalog (the palette) — tables + columns + provenance + distinct values
# --------------------------------------------------------------------------- #


def distinct_values(table: str, column: str, limit: int = 500) -> list[Any]:
    """Distinct values of an allowlisted dimension column (palette pickers). The
    table and column are allowlist-checked; the result is bound by ``limit``."""
    spec = DATASET_TABLES.get(table)
    if spec is None:
        raise DatasetError(f"unknown source table {table!r}")
    if column not in spec["columns"]:
        raise DatasetError(f"unknown column {column!r} on {table!r}")
    if column not in spec.get("dimensions", ()):  # only enumerate dimensions
        raise DatasetError(f"{column!r} is not an enumerable dimension of {table!r}")
    if table == "allocation_cost_lines":
        ensure_cost_lines_relation()
    rows = q(
        f'SELECT DISTINCT "{column}" AS v FROM {spec["view"]} '
        f'WHERE "{column}" IS NOT NULL ORDER BY 1 LIMIT {int(limit)}'
    )
    return [r["v"] for r in rows]


def active_dataset_sources() -> list[dict[str, Any]]:
    """Active authored datasets (DS2) offered as referenceable sources in the
    palette: each one's ``table`` is ``dataset/{id}``, its output columns are the
    compiled terminal schema, and its provenance is ``authored``. A draft/tested/
    in_review dataset is NOT offered (only an ACTIVE dataset can be referenced).
    Best-effort per dataset: one whose graph fails to compile is skipped rather
    than breaking the whole palette. Deferred import keeps the lifecycle module
    off this compiler's import path."""
    import state.authored_datasets as authored_datasets  # deferred: avoid cycle

    out: list[dict[str, Any]] = []
    for d in authored_datasets.list_authored_datasets(status="active"):
        try:
            _sql, _params, cols = compile_dataset(d["graph"])
        except DatasetError:
            continue
        out.append({
            "table": f"{_DATASET_SOURCE_PREFIX}{d['id']}",
            "dataset_id": d["id"],
            "view": None,
            "label": d["name"],
            "provenance": "authored",
            "catalog_id": f"dataset:{d['id']}",
            "columns": [{"name": c, "role": _DIM, "type": "VARCHAR"} for c in cols],
            "measures": [],
            "join_keys": list(cols),
            "dimensions": list(cols),
        })
    return out


def sources_catalog() -> dict[str, Any]:
    """The palette catalogue: every source with its columns (role + type),
    provenance, join keys, enumerable dimensions, and — for the journal — the
    real distinct GL / CC / PC value lists the user asked to see, plus the
    ACTIVE authored datasets (``dataset/{id}`` sources). Pure read."""
    ensure_cost_lines_relation()
    tables = []
    for name, spec in DATASET_TABLES.items():
        tables.append({
            "table": name,
            "view": spec["view"],
            "label": spec["label"],
            "provenance": spec["provenance"],
            "catalog_id": spec["catalog_id"],
            "columns": [
                {"name": c, "role": m["role"], "type": m["type"]}
                for c, m in spec["columns"].items()
            ],
            "measures": list(_measures(spec)),
            "join_keys": list(spec["join_keys"]),
            "dimensions": list(spec.get("dimensions", ())),
        })
    journal_values = {
        "RACCT": distinct_values("journal_entries", "RACCT"),
        "RCNTR": distinct_values("journal_entries", "RCNTR"),
        "PRCTR": distinct_values("journal_entries", "PRCTR"),
    }
    return {
        "tables": tables,
        "datasets": active_dataset_sources(),
        "node_types": dataset_node_types(),
        "filter_ops": sorted(_FILTER_OPS),
        "agg_funcs": sorted(_AGG_FUNCS),
        "arith_ops": list(_ARITH_OPS),
        "journal_distinct": journal_values,
    }
