"""Shared test fixtures."""

from __future__ import annotations

import pytest

import state.engine as engine


@pytest.fixture
def state_db(tmp_path):
    """Isolated SQLite state DB per test (temp file, fresh schema)."""
    engine.configure(tmp_path / "state.db")
    engine.init_db()
    yield
    engine.close()
