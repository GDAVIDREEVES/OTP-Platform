# Phase 5 — Author & Apply: Calculation Builder + TP Waterfall (approved)

User decisions (2026-06-10): authoring = structured term pickers + syntax-checked formula bar;
P&L application = side-by-side (Base | IC charges | Post-charge) with a governed opt-in toggle;
build BOTH in one phase, gated increments W1–W5.

## A. TP Calculation Waterfall (close-flow correctness)
Charges must be computed and APPLIED to each entity / entity-function P&L BEFORE TP decisions
(monitoring OTP-20, adjustments OTP-16, goods pricing OTP-1/2).
- **W1 backend:** `pl_overlays` append-only SQLite table (entity, function|null, period, line_kind
  [service_charge|royalty|csa_true_up|profit_split|other], amount in/out, source_ref (charge/run),
  waterfall_run_id; audited; reversing rows for corrections). Waterfall orchestrator
  `backend/services/waterfall_runner.py`: ordered, configurable step sequence (default:
  service_allocation → royalties → csa_true_up → profit_split), each step runs the underlying calc
  via calc_registry/allocation runner and maps outputs to overlay lines (provider revenue+, recipient
  cost+ — double-entry per charge, nets to zero group-wide; test-enforced). `/api/waterfall/runs`
  (POST run/GET status+impact), `/api/pl/adjusted?year&grain=entity|entity_function` = base
  segment_pl + overlays with per-line provenance + source refs. Tie-out tests: overlay totals ==
  source ledgers/batches to the cent; group net == 0; post-charge margins recompute.
- **W2 frontend:** Calc Studio ▸ **Waterfall** tab (sequence console: steps, status, applied
  amounts, per-entity impact table, run/rollback[reversing rows]); Segmented P&L page gains
  Base | IC charges | Post-charge columns w/ provenance chips; governed param `pl.use_post_charge`
  (assumed, OTP-49) toggles OTP-20/OTP-16/OTP-1 reads to post-charge margins (server-side: margins/
  kpis/forecast endpoints accept ?pl=post_charge resolved from the param; default base until a
  waterfall run is applied).

## B. Calculation Builder (author from scratch)
- **W3 backend:** safe expression engine `backend/calc/expr.py` — tokenizer/AST/Decimal evaluator,
  NO eval/exec. Terms: `param('key')`, `measure('segment_pl.revenue', grain, filters?)` (warehouse
  aggregates via calc.warehouse), `calc('csa', 'pool')` (composition from registry run output),
  literals; ops + - * / ( ) and funcs sum/min/max/abs/if(cond,a,b); comparison ops in if.
  Trace emission per term (param/measure/calc events). `user_calculations` SQLite table + state
  module (draft→test→active w/ maker-checker activation via review queue record_ref=ucalc:{id};
  versioned, audited) + `/api/user-calcs` CRUD + validate + preview (evaluate w/o persisting).
  Registry integration: user calcs appear in /api/calcs (kind "user-defined" vs "system"),
  runnable/traceable/scenario-capable via an expression runner.
- **W4 frontend:** Calc Studio ▸ Calculations ▸ **"New calculation"**: wizard — name/type/process
  binding + output grain; term pickers (governed parameters list, warehouse measures, existing
  calcs) inserting tokens into a formula bar with live syntax/term validation + **Preview** (PaPM
  "Show": evaluates and renders result + trace); save Draft → Test run → Submit for activation
  (review queue; maker≠checker) → Active in registry with system/user-defined chips. Edit =
  new version (append-only changelog from audit).
- **W5:** end-to-end verify (waterfall run → P&L columns → toggle flips OTP-20 margins; author a
  calc using csa.growth + segment_pl.revenue → preview → activate → run/trace/scenario) + README
  /README-WORKFLOW updates.

House rules as always: Decimal money, append-only, no silent defaults, audit every mutation,
mirror existing patterns (cases.py state style, calc_registry, review.decide() hook for ucalc:
and waterfall refs), full pytest + typecheck/build gates per increment, golden non-regression
(existing endpoints byte-identical with the toggle off).

## Decisions (W5 — end-to-end verification, 2026-06-11)

Live verification ran against the dev server (:8000) over the real demo state; no code
fixes were needed — both loops passed exactly as built. Judgment calls:

1. **Verification artifacts stay in the state DB (append-only by design).** The live loop
   left: waterfall run WF-5 (status `rolled_back`, overlay nets to $0.00), user calculation
   UC-3 "Projected entity revenue (growth-adjusted)" (ACTIVE, v1, maker greg.reeves /
   checker dana.reviewer), scenario SC-1 (discarded), four UC-3 calc runs, the approved
   `ucalc:UC-3` review item, and their hash-chained audit events. There is no delete API for
   any of these (deliberately), and `state.migrate --reset` was out of bounds for this
   increment. A pristine demo reset clears them.
2. **Byte-identity scope.** After rollback + param reset, `/api/margins/trend`, `/api/kpis`,
   `/api/forecast` and `/api/segments/pl` were verified byte-for-byte identical to their
   pre-run captures (also identical with a run APPLIED while the toggle was off, and with
   the toggle ON but no applied run — the "default base until applied" contract).
   `/api/pl/adjusted` is a NEW endpoint and is excluded from byte-identity: after a
   rollback it shows the netted ledger (original + reversing rows summing to `0.00`)
   rather than an empty one — that is the append-only ledger telling the truth.
3. **Maker-checker proven negatively too:** the same-actor approve of `ucalc:UC-3` was
   asserted to fail (409 "a maker cannot approve their own work") before the different-actor
   approve activated the calc.
4. **Zero contamination evidence:** scenario compare (csa.growth 0.08 → 0.12) scaled UC-3's
   total by exactly 1.12/1.08; the governed param read back 0.08 throughout, and all three
   governed registry runs produced the identical output digest while the SC-1-tagged run
   produced a different one.
5. **Docs placement:** the waterfall close sequence became **Flow 4** in README-WORKFLOW.md
   (charges applied to entity P&L BEFORE monitoring/adjustments/pricing), with a cross-ref
   from Flow 1 step 5; the Calculation Builder became Flow 2 steps 6–8. README.md's Calc
   Studio bullet gained the Builder + Waterfall tabs, and the architecture section gained
   the `expr.py`/`user_calcs.py` and `waterfall_runner.py`/`pl_overlays.py` subsystems.
