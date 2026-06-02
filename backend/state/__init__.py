"""Mutable application state — SQLite-backed.

DuckDB + parquet remains the read-only analytical engine for the ACDOCA
data. This package owns everything that *changes*: the append-only audit
stream, workflow drafts, users/roles, the review queue, and the records
migrated out of the old JSON store.
"""
