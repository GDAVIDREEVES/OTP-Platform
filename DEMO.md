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

## AI surfaces (graceful degradation)

Two AI surfaces; both degrade gracefully — the demo never breaks if a service or
key is missing.

- **Agentic prepare** (OTP-16 step 1, and the OTP-3 / OTP-9 / OTP-25 wizards) is
  always real: it computes from the warehouse server-side (real posting counts,
  gap-to-range) and logs an assisted "prepared" event to the audit trail. No
  external service required.
- **TP Q&A** (the Research Brain panel) calls the separate **researchbrain**
  service for citation-backed retrieval. To run the live path:

  ```bash
  # 1. Qdrant vector DB on :6333  (researchbrain dependency)
  # 2. in the researchbrain repo:
  export ANTHROPIC_API_KEY=sk-ant-...   # Claude synthesis
  export VOYAGE_API_KEY=pa-...          # embeddings + rerank
  npm start                              # serves :3000
  curl http://127.0.0.1:3000/api/health  # verify
  ```

  Point the OTP backend at it with `RESEARCH_BRAIN_BASE_URL` (default
  `http://127.0.0.1:3000`), and set `ANTHROPIC_API_KEY` for the OTP backend too if
  you want it to synthesise the retrieved chunks into prose. Without researchbrain
  the panel shows a shaped "offline" answer with a clear live/offline indicator.

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
8. **Audit rail & evidence** — the history icon by the tabs toggles a live event
   rail on any module. From a submitted record (OTP-16 confirmation, a
   review-queue item, or a wizard completion) open the **Evidence packet**: event
   history, before/after diffs, linked ACDOCA postings, chain-verify, Print/export.
9. **Guided wizards** — OTP-3 (rate setting), OTP-9 (charge → stage → post), and
   OTP-25 (benchmarking refresh) each run a prepare → … → gated-submit path that
   lands in the review queue.

## Tests

```bash
cd backend && ../.venv/bin/python -m pytest tests   # backend
npm run typecheck && npm run build                  # frontend
```
