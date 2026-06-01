# OTP Platform — demo runbook

The platform is an operational transfer-pricing "close cockpit": one reusable
module shell across 50 processes (OTP-1…50), a role-aware home, guided
AI-assisted workflows with a visible hand-off, an append-only hash-chained audit
trail, and a director exposure view. Built on React/MUI + FastAPI + DuckDB/Parquet,
with SQLite for mutable state.

## Run it

```bash
./scripts/dev.sh          # FastAPI :8000 + Vite :5173, one Ctrl-C stops both
```

- Boots out of the box on the committed sample dataset (`data/parquet/`).
- For full-fidelity data, set `DATA_DIR` in `backend/.env` to a full ACDOCA export.
- Open http://localhost:5173 → **Enter Demo Workspace**.

## Reset to a pristine demo

Verification/usage leaves records in the audit stream, drafts, and review queue.
To start clean (server stopped):

```bash
cd backend && ../.venv/bin/python -m state.migrate --reset
```

This wipes `backend/state/otp_state.db` (git-ignored), recreates the schema, and
re-imports the seeds. The ACDOCA Parquet data is untouched.

## Live Research Brain (optional)

The Research Brain answers TP questions from the separate **researchbrain**
service. With it running at `http://127.0.0.1:3000` (override via
`RESEARCH_BRAIN_BASE_URL`), answers are live and citation-backed; set
`ANTHROPIC_API_KEY` for Claude synthesis. Without it, the panel degrades
gracefully to a shaped "offline" answer — the demo never breaks.

## The walkthrough (operator → reviewer → director)

1. **Home** (`/home`) — role-aware operating-cadence home. Switch persona from
   the top-right avatar (Operator / Reviewer / Director).
2. **Process library** (`/process`) — all 50 processes by lifecycle category A–G;
   ⌘K / Ctrl-K opens the command palette. ~12 marquee processes are wired with
   live data; the rest are informative.
3. **OTP-20 Operating-margin monitoring** — answer-first KPIs, exceptions-first
   worklist, drill any margin to its ACDOCA postings. Click **Adjust** on a flag.
4. **OTP-16 Adjustment** (guided) — Research Brain prepares (pulls postings,
   applies policy, quantifies the gap) → **visible hand-off** → you quantify →
   gated submit with rationale. Leaving and returning resumes at the exact step.
5. **Review queue** (`/review`) — switch to **Reviewer**, approve/return. A maker
   cannot approve their own work.
6. **Audit** — any process's Audit tab shows the append-only stream
   (created → submitted → approved, assistant logged distinctly) with one-click
   chain verification.
7. **Director** (`/director`) — group exposure: IC flow, Pillar Two top-up, TP
   reserve, jurisdictional risk, top-15 health; board-pack from live data.

## Tests

```bash
cd backend && ../.venv/bin/python -m pytest tests   # backend
npm run typecheck && npm run build                  # frontend
```
