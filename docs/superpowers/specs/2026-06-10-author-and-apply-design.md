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
