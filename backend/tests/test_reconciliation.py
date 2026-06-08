"""TDD for the ERP↔TP reconciliation endpoint (routers/reconciliation.py).

OTP-43 (recon) and OTP-42 (billing controls) both read this single source, so
the guarantees that matter are: every planned flow appears exactly once, the
posted figure derives from the ACDOCA journal by AWREF (not hardcoded), the
status partitions cleanly, and the four KPI counts add up to the row total.

Run from `backend/`:  python -m pytest tests/test_reconciliation.py
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from db import q
from main import app
from routers.reconciliation import VALUE_BREAK_TOLERANCE

client = TestClient(app)

VALID_STATUS = {"reconciled", "unposted", "value-break", "challenged"}


def _recon(**params):
    r = client.get("/api/reconciliation", params=params)
    assert r.status_code == 200
    return r.json()


def test_shape():
    d = _recon()
    assert set(d) == {"summary", "rows"}
    assert isinstance(d["rows"], list) and d["rows"]
    row = d["rows"][0]
    for key in ("awref", "seller", "buyer", "tpMethod", "planned", "posted", "delta", "status"):
        assert key in row


def test_every_status_is_valid():
    for row in _recon()["rows"]:
        assert row["status"] in VALID_STATUS


def test_one_row_per_awref():
    rows = _recon()["rows"]
    awrefs = [r["awref"] for r in rows]
    assert len(awrefs) == len(set(awrefs))


def test_row_count_matches_planned_book():
    """Every supply_chain AWREF appears exactly once — the LEFT JOIN to postings
    must never drop an unposted flow."""
    planned = q("SELECT COUNT(DISTINCT AWREF) AS n FROM supply_chain WHERE AWREF IS NOT NULL")[0]["n"]
    assert _recon()["summary"]["total"] == planned == len(_recon()["rows"])


def test_summary_counts_partition_total():
    s = _recon()["summary"]
    assert s["reconciled"] + s["unposted"] + s["value-breaks"] + s["challenged"] == s["total"]


def test_summary_counts_match_rows():
    d = _recon()
    rows = d["rows"]
    s = d["summary"]
    assert s["reconciled"] == sum(1 for r in rows if r["status"] == "reconciled")
    assert s["unposted"] == sum(1 for r in rows if r["status"] == "unposted")
    assert s["value-breaks"] == sum(1 for r in rows if r["status"] == "value-break")
    assert s["challenged"] == sum(1 for r in rows if r["status"] == "challenged")


def test_unposted_has_no_posted_value():
    for r in _recon()["rows"]:
        if r["status"] == "unposted":
            assert r["posted"] is None
            assert r["delta"] == 0.0


def test_reconciled_delta_within_tolerance():
    for r in _recon()["rows"]:
        if r["status"] == "reconciled":
            assert r["posted"] is not None
            assert abs(r["delta"]) <= VALUE_BREAK_TOLERANCE


def test_value_break_exceeds_tolerance():
    for r in _recon()["rows"]:
        if r["status"] == "value-break":
            assert r["posted"] is not None
            assert abs(r["delta"]) > VALUE_BREAK_TOLERANCE


def test_posted_derives_from_journal():
    """Spot-check that the posted figure for a reconciled flow equals the
    journal's MAX(ABS(HSL)) for that AWREF — i.e. it is read from ACDOCA, not
    copied from the planned book."""
    reconciled = [r for r in _recon()["rows"] if r["status"] == "reconciled"]
    assert reconciled, "expected at least one reconciled flow in the demo data"
    r = reconciled[0]
    posted = q(
        "SELECT MAX(ABS(HSL)) AS p FROM journal WHERE AWREF = ?", [r["awref"]]
    )[0]["p"]
    assert abs(float(posted) - r["posted"]) < 0.01


def test_challenged_takes_priority():
    """A challenged flow is reported as challenged regardless of whether it
    posted — it needs human attention before it can be considered reconciled."""
    challenged_awrefs = {
        row["AWREF"]
        for row in q("SELECT DISTINCT AWREF FROM supply_chain WHERE CHALLENGED_FLAG AND AWREF IS NOT NULL")
    }
    for r in _recon()["rows"]:
        if r["awref"] in challenged_awrefs:
            assert r["status"] == "challenged"
            assert r["challenged"] is True


def test_year_filter():
    """An out-of-range year yields an empty (but well-formed) reconciliation."""
    d = _recon(year=1900)
    assert d["rows"] == []
    assert d["summary"]["total"] == 0
    assert d["summary"]["planned_total"] == 0.0


def test_journal_entries_awref_filter_drives_drill():
    """The OTP-43 posting drill relies on /api/journal-entries?awref= returning
    only that reference's postings (each carrying AWREF) — assert that contract."""
    posted = [r for r in _recon()["rows"] if r["status"] == "reconciled"]
    assert posted
    awref = posted[0]["awref"]
    je = client.get("/api/journal-entries", params={"awref": awref})
    assert je.status_code == 200
    rows = je.json()
    assert rows, "expected at least one posting for a reconciled flow"
    assert all(j["AWREF"] == awref for j in rows)
