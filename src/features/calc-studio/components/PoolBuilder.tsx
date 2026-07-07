import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ScienceIcon from '@mui/icons-material/Science';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SendOutlinedIcon from '@mui/icons-material/Send';
import { api } from '@/shared/api/client';
import { useToast } from '@/shared/providers/DataProvider';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useRefreshSignals } from '@/shared/providers/WorkSignalsProvider';
import { useReviewHandoff } from '@/kernel/review/ReviewHandoff';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import { HistoryButton } from '@/kernel/audit/HistoryDrawer';
import LifecycleChip from '@/shared/components/LifecycleChip';
import PovChip from '@/shared/components/PovChip';
import type {
  AllocationDimensionOption,
  AllocationDimensions,
  AllocationEntityRow,
  AuthoredCaptureRule,
  AuthoredDryRun,
  AuthoredExclusion,
  AuthoredMarkupPolicy,
  AuthoredPool,
  AuthoredPoolDefinition,
  AuthoredRunResult,
  CapturePreview,
} from '@/shared/api/types';
import { fmtAmount, fmtPct, isNonZero } from '../allocationLib';

/** Pool Builder (Phase 6 PB3) — the authoring layer on top of the allocation
 *  engine, the 7th view of the Allocations workbench. The user assembles a
 *  cost-to-charge pool (metadata + cost-capture rule + beneficiaries + key +
 *  exclusions + per-jurisdiction markup), previews the captured cost live
 *  (/api/allocation/pools/preview), test-runs it through the REAL Stages 1-7 in
 *  isolation (charges/recon/exceptions/trace, no persist), then saves a draft
 *  and submits for activation — a DIFFERENT reviewer approves the allocpool:{id}
 *  item in the /review queue (maker-checker). Active pools run via an authored
 *  allocation run (flagged `authored` — the governed seeded allocation is never
 *  touched). Every amount is an exact decimal string (no float math). */

const KEY_FACTORS = ['Equal', 'Revenue', 'Cost'] as const;
const EXCLUSION_TYPES = ['Stewardship', 'Pass-through', 'Duplicative', 'Shareholder', 'Other'];

type ExclusionDraft = { type: string; mode: 'amount' | 'pct'; value: string; basis_rationale: string };
type MarkupDraft = { jurisdiction: string; regime: string; markup_pct: string; benchmark_study_ref: string };

// ----------------------------------------------------------- empty drafts --

function emptyExclusion(): ExclusionDraft {
  return { type: EXCLUSION_TYPES[0], mode: 'amount', value: '', basis_rationale: '' };
}
function emptyMarkup(): MarkupDraft {
  return { jurisdiction: '', regime: 'Benchmarked', markup_pct: '', benchmark_study_ref: '' };
}

// -------------------------------------------------------- builder → API def --

/** Assemble the authoring object the backend validator expects. Empty optional
 *  collections are sent as empty arrays; a blank split is omitted (full capture). */
function toDefinition(s: BuilderState): AuthoredPoolDefinition {
  const capture: AuthoredCaptureRule = {
    cost_centers: s.costCenters.length ? s.costCenters : null,
    profit_centers: s.profitCenters.length ? s.profitCenters : null,
    cost_elements: s.costElements.length ? s.costElements : null,
    split_pct: s.splitPct.trim() ? s.splitPct.trim() : null,
  };
  const exclusions: AuthoredExclusion[] = s.exclusions.map((e) => ({
    type: e.type,
    amount: e.mode === 'amount' ? e.value.trim() : null,
    pct: e.mode === 'pct' ? e.value.trim() : null,
    basis_rationale: e.basis_rationale.trim(),
  }));
  const markup_policies: AuthoredMarkupPolicy[] = s.markups.map((m) => ({
    jurisdiction: m.jurisdiction.trim(),
    regime: m.regime.trim(),
    markup_pct: m.markup_pct.trim(),
    benchmark_study_ref: m.benchmark_study_ref.trim() || null,
  }));
  return {
    name: s.name.trim(),
    provider_entity_id: s.provider,
    service_line: s.serviceLine.trim(),
    characterization: s.characterization.trim(),
    cost_base_definition: s.costBase.trim(),
    cost_capture_rule: capture,
    beneficiaries: s.beneficiaries,
    key: { key_factor: s.keyFactor },
    exclusions,
    markup_policies,
  };
}

interface BuilderState {
  name: string;
  provider: string;
  serviceLine: string;
  characterization: string;
  costBase: string;
  costCenters: string[];
  profitCenters: string[];
  costElements: string[];
  splitPct: string;
  beneficiaries: string[];
  keyFactor: (typeof KEY_FACTORS)[number];
  exclusions: ExclusionDraft[];
  markups: MarkupDraft[];
}

const BLANK: BuilderState = {
  name: '',
  provider: '',
  serviceLine: '',
  characterization: 'Routine-benchmarked',
  costBase: 'Total services cost',
  costCenters: [],
  profitCenters: [],
  costElements: [],
  splitPct: '',
  beneficiaries: [],
  keyFactor: 'Equal',
  exclusions: [],
  markups: [],
};

// ----------------------------------------------------------- small elements --

/** The provenance-honest "authored" marker — an authored pool is a governed
 *  experiment, NOT claimed to tie to the warehouse SERVICE pairs. Dashed violet
 *  to read like the fabricated provenance class. */
function AuthoredChip() {
  return (
    <Tooltip
      arrow
      title="Authored pool — a governed experiment run through the real engine in isolation; it does not tie to the warehouse SERVICE pairs."
    >
      <Chip
        size="small"
        label="authored"
        variant="outlined"
        sx={{
          height: 20,
          fontSize: 11,
          fontWeight: 700,
          borderStyle: 'dashed',
          borderColor: '#7C3AED',
          color: '#6D28D9',
        }}
      />
    </Tooltip>
  );
}

/** A dimension multiselect (cost centers / profit centers / GL accounts) — each
 *  option shows its TOTAL cost so the user picks by magnitude. */
function DimensionPicker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: AllocationDimensionOption[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <TextField
      select
      size="small"
      label={label}
      value={value}
      onChange={(e) =>
        onChange(typeof e.target.value === 'string' ? [e.target.value] : (e.target.value as unknown as string[]))
      }
      SelectProps={{
        multiple: true,
        renderValue: (selected) => `${(selected as string[]).length} selected`,
      }}
      fullWidth
      helperText={`${options.length} available`}
    >
      {options.map((o) => (
        <MenuItem key={o.value} value={o.value}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
            <Typography variant="body2" sx={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}>
              {o.value}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
              {fmtAmount(o.total_cost)}
            </Typography>
          </Stack>
        </MenuItem>
      ))}
    </TextField>
  );
}

// --------------------------------------------------- compact result tables --

function DryRunResult({
  dry,
  entityName,
}: {
  dry: AuthoredDryRun;
  entityName: Record<string, string>;
}) {
  const blocks = dry.exceptions.filter((e) => e.severity === 'BLOCK');
  const warns = dry.exceptions.filter((e) => e.severity === 'WARN');
  return (
    <Stack spacing={2}>
      <Alert severity={dry.balanced && blocks.length === 0 ? 'success' : 'error'} variant="outlined">
        {dry.balanced && blocks.length === 0 ? (
          <>
            Dry-run <b>Balanced</b> — pooled = exclusions + recovered + residual 0 (V-X1), across{' '}
            {dry.periods.join(', ') || '—'}. {fmtAmount(dry.total_charged_out)} charged out · this pool
            is now <b>tested</b> and can be submitted for activation.
          </>
        ) : (
          <>
            Dry-run <b>not sound</b> — {blocks.length} BLOCK / {warns.length} WARN. The pool stays a
            draft: fix the definition (see the exception remediation) and re-test.
          </>
        )}
      </Alert>

      {/* Recon */}
      {dry.recon.length > 0 && (
        <Box>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
            Recon (Stages 1-7 in isolation)
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Period</TableCell>
                  <TableCell align="right">Pooled</TableCell>
                  <TableCell align="right">Exclusions</TableCell>
                  <TableCell align="right">Recovered</TableCell>
                  <TableCell align="right">Markup</TableCell>
                  <TableCell align="right">Charged out</TableCell>
                  <TableCell align="right">Residual</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {dry.recon.map((r) => (
                  <TableRow key={`${r.pool_id}-${r.period}`} hover>
                    <TableCell>{r.period}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtAmount(r.total_pooled_cost)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtAmount(r.total_exclusions)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtAmount(r.total_cost_recovered)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtAmount(r.total_markup)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtAmount(r.total_charged_out)}</TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                        fontWeight: 700,
                        color: isNonZero(r.unallocated_residual) ? 'error.main' : 'success.main',
                      }}
                    >
                      {fmtAmount(r.unallocated_residual)}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={r.recon_status === 'Balanced' ? 'success' : 'error'}
                        label={r.recon_status}
                        sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* Charges */}
      {dry.charges.length > 0 && (
        <Box>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
            Charges
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Provider → recipient</TableCell>
                  <TableCell>Period</TableCell>
                  <TableCell align="right">Cost</TableCell>
                  <TableCell align="right">Markup</TableCell>
                  <TableCell align="right">Gross</TableCell>
                  <TableCell>Ccy</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {dry.charges.map((c) => (
                  <TableRow key={c.charge_id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {c.provider_entity_id} → {c.recipient_entity_id}
                      {entityName[c.recipient_entity_id] ? (
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                          {entityName[c.recipient_entity_id]}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>{c.period}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtAmount(c.cost_recovered_amount)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {fmtAmount(c.markup_amount)}
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                        {fmtPct(c.markup_pct_applied)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: 700 }}>{fmtAmount(c.gross_charge_amount)}</TableCell>
                    <TableCell>{c.charge_currency}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* Exceptions */}
      {dry.exceptions.length > 0 && (
        <Box>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
            Exceptions ({blocks.length} BLOCK / {warns.length} WARN)
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Rule</TableCell>
                  <TableCell>Severity</TableCell>
                  <TableCell>Message</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {dry.exceptions.map((e, i) => (
                  <TableRow key={`${e.rule_id}-${i}`} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700, whiteSpace: 'nowrap' }}>{e.rule_id}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={e.severity === 'BLOCK' ? 'error' : 'warning'}
                        label={e.severity}
                        sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
                      />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 520 }}>
                      <Typography variant="body2" sx={{ fontSize: 13 }}>{e.message}</Typography>
                      {e.remediation && (
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{e.remediation}</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* Trace */}
      {dry.trace.length > 0 && (
        <Box>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
            Value-flow trace
          </Typography>
          <Stack spacing={0.75} sx={{ mt: 0.5 }}>
            {dry.trace.map((t, i) => {
              const detail = Object.entries(t).filter(([k]) => k !== 'step');
              return (
                <Box
                  key={`${t.step}-${i}`}
                  sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                    <Chip
                      size="small"
                      label={t.step}
                      sx={{ height: 20, fontSize: 11, fontFamily: 'monospace' }}
                    />
                    {detail.map(([k, v]) => (
                      <Typography
                        key={k}
                        variant="caption"
                        sx={{ fontFamily: 'monospace', bgcolor: '#F1F5F9', borderRadius: 0.5, px: 0.75, py: 0.25 }}
                      >
                        {k} = {String(v)}
                      </Typography>
                    ))}
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

// -------------------------------------------------------------------- main --

export default function PoolBuilder({
  entities,
  periods,
  defaultPeriod,
  initialPoolId,
  onInitialPoolConsumed,
}: {
  entities: AllocationEntityRow[];
  /** POV-scoped billing months + default, derived by the parent (AllocationsTab)
   *  and passed down so nothing re-fetches — PoolBuilder is only ever its child. */
  periods: string[];
  defaultPeriod: string;
  /** Preload this pool into the form on mount (?view=build&pool={id} deep-link
   *  — the "Fix & resubmit" landing for a rejected allocpool:{id} item). */
  initialPoolId?: string;
  /** Called once the deep-link pool has been loaded, so the owner can clear the
   *  `pool` URL param and a later remount can't re-clobber in-progress edits. */
  onInitialPoolConsumed?: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const user = useSessionUser();
  const refreshSignals = useRefreshSignals();
  const { notifySubmitted } = useReviewHandoff();
  // Every authoring mutation acts as the current persona (maker-checker: the
  // review item's maker must be the signed-in user so SoD engages). This is
  // PoolBuilder's slice of the GP3 u_demo cleanup, pulled forward because GP1's
  // SoD affordances depend on it.
  const ACTOR = user.id;
  const entityName = useMemo(
    () => Object.fromEntries(entities.map((e) => [e.entity_id, e.legal_entity_name])),
    [entities],
  );

  // Cost-line dimensions (capture-rule pickers).
  const [dims, setDims] = useState<AllocationDimensions | null>(null);
  useEffect(() => {
    api.allocationDimensions().then(setDims).catch(() => setDims(null));
  }, []);

  // Authored-pool list.
  const [pools, setPools] = useState<AuthoredPool[] | null>(null);
  const refreshPools = () =>
    api.authoredPools().then(setPools).catch(() => setPools([]));
  useEffect(() => {
    void refreshPools();
  }, []);

  // The builder form + the pool it is editing (null = new draft).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [s, setS] = useState<BuilderState>(BLANK);
  const set = <K extends keyof BuilderState>(k: K, v: BuilderState[K]) =>
    setS((prev) => ({ ...prev, [k]: v }));

  // Live preview of the capture rule (no persist) — refetched on rule change.
  const [preview, setPreview] = useState<CapturePreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const captureKey = JSON.stringify([s.costCenters, s.profitCenters, s.costElements, s.splitPct]);
  const hasCapture = s.costCenters.length > 0 || s.profitCenters.length > 0 || s.costElements.length > 0;
  useEffect(() => {
    if (!hasCapture) {
      setPreview(null);
      setPreviewErr(null);
      return;
    }
    let alive = true;
    const rule: AuthoredCaptureRule & { source?: string } = {
      cost_centers: s.costCenters.length ? s.costCenters : null,
      profit_centers: s.profitCenters.length ? s.profitCenters : null,
      cost_elements: s.costElements.length ? s.costElements : null,
      split_pct: s.splitPct.trim() ? s.splitPct.trim() : null,
    };
    api
      .previewCaptureRule(rule)
      .then((p) => {
        if (alive) {
          setPreview(p);
          setPreviewErr(null);
        }
      })
      .catch((e) => {
        if (alive) {
          setPreview(null);
          setPreviewErr(String(e));
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureKey, hasCapture]);

  // Dry-run result (Test run) for the form's pool.
  const [dryRun, setDryRun] = useState<AuthoredDryRun | null>(null);
  const [busy, setBusy] = useState<null | 'save' | 'test' | 'submit'>(null);

  // Authored run (active-pool run) result.
  const [runResult, setRunResult] = useState<AuthoredRunResult | null>(null);
  const [runBusy, setRunBusy] = useState(false);

  const resetForm = () => {
    setEditingId(null);
    setS(BLANK);
    setPreview(null);
    setPreviewErr(null);
    setDryRun(null);
  };

  const loadIntoForm = (p: AuthoredPool) => {
    const d = p.definition;
    const cap = d.cost_capture_rule || {};
    setEditingId(p.id);
    setS({
      name: d.name ?? '',
      provider: d.provider_entity_id ?? '',
      serviceLine: d.service_line ?? '',
      characterization: d.characterization ?? '',
      costBase: d.cost_base_definition ?? '',
      costCenters: cap.cost_centers ?? [],
      profitCenters: cap.profit_centers ?? [],
      costElements: cap.cost_elements ?? [],
      splitPct: cap.split_pct ?? '',
      beneficiaries: d.beneficiaries ?? [],
      keyFactor: (d.key?.key_factor ?? 'Equal') as (typeof KEY_FACTORS)[number],
      exclusions: (d.exclusions ?? []).map((e) => ({
        type: e.type,
        mode: e.pct != null ? 'pct' : 'amount',
        value: (e.pct ?? e.amount ?? '') as string,
        basis_rationale: e.basis_rationale ?? '',
      })),
      markups: (d.markup_policies ?? []).map((m) => ({
        jurisdiction: m.jurisdiction,
        regime: m.regime,
        markup_pct: m.markup_pct,
        benchmark_study_ref: m.benchmark_study_ref ?? '',
      })),
    });
    setDryRun(null);
    setPreview(null);
  };

  // Deep-link preload: once the pools arrive, load the ?pool= target into the
  // form, bring it into view, and ask the owner to clear the param — so a
  // remount (Build → other tab → Build) can't re-run over the user's edits.
  const formRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!initialPoolId || pools === null) return;
    const target = pools.find((p) => p.id === initialPoolId);
    if (!target) return;
    loadIntoForm(target);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    onInitialPoolConsumed?.();
    // loadIntoForm is recreated per render; keying on the data is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPoolId, pools]);

  // -------- persistence + lifecycle --------

  /** Save the form as a draft (create or edit), returning the persisted pool. */
  const saveDraft = async (): Promise<AuthoredPool | null> => {
    setBusy('save');
    try {
      const def = toDefinition(s);
      const saved = editingId
        ? await api.updateAuthoredPool(editingId, ACTOR, def)
        : await api.createAuthoredPool(def, ACTOR);
      setEditingId(saved.id);
      await refreshPools();
      toast.show(`Draft saved — ${saved.id} ${saved.name}`, 'success');
      return saved;
    } catch (e) {
      toast.show(`Save failed: ${String(e)}`, 'error');
      return null;
    } finally {
      setBusy(null);
    }
  };

  /** Save (if needed) then dry-run through Stages 1-7 in isolation. */
  const testRun = async () => {
    setBusy('test');
    try {
      let id = editingId;
      // Always persist the CURRENT form first so the tested-hash gate matches.
      const def = toDefinition(s);
      const saved = id
        ? await api.updateAuthoredPool(id, ACTOR, def)
        : await api.createAuthoredPool(def, ACTOR);
      id = saved.id;
      setEditingId(id);
      const res = await api.testAuthoredPool(id, ACTOR);
      setDryRun(res.dry_run);
      await refreshPools();
      if (res.tested) {
        toast.show(`Test passed — ${id} is tested and ready to submit`, 'success');
      } else {
        const blocks = res.dry_run.exceptions.filter((e) => e.severity === 'BLOCK').length;
        toast.show(`Test ran — not sound (${blocks} BLOCK) · pool stays a draft`, 'warning');
      }
    } catch (e) {
      toast.show(`Test run failed: ${String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  /** Submit the (tested) pool for activation — enqueues the maker-checker item. */
  const submitForActivation = async () => {
    if (!editingId) {
      toast.show('Save and test the pool before submitting for activation.', 'warning');
      return;
    }
    setBusy('submit');
    try {
      const updated = await api.submitAuthoredPoolActivation(editingId, ACTOR);
      await refreshPools();
      void refreshSignals(); // bell badge / home Command Center / My work
      notifySubmitted({
        recordRef: `allocpool:${updated.id}`,
        processId: updated.process_id ?? undefined,
        label: updated.name,
      });
    } catch (e) {
      toast.show(`Submit failed: ${String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const deletePool = async (p: AuthoredPool) => {
    try {
      await api.deleteAuthoredPool(p.id, ACTOR);
      if (editingId === p.id) resetForm();
      await refreshPools();
      toast.show(`${p.id} deleted`, 'success');
    } catch (e) {
      toast.show(`Delete failed: ${String(e)}`, 'error');
    }
  };

  /** Run authored allocation for active pools touching a period. */
  const runAuthored = async (period: string) => {
    setRunBusy(true);
    setRunResult(null);
    try {
      const res = await api.runAuthoredAllocation({ actor: ACTOR, period });
      setRunResult(res);
      if (res.summary.status === 'succeeded') {
        toast.show(
          `Authored run ${res.run_id} succeeded — recon ${res.summary.recon_balanced ? 'Balanced' : 'with breaks'}`,
          'success',
        );
      } else {
        toast.show(`Authored run ${res.run_id} failed — ${res.exception_report.counts.BLOCK} BLOCK`, 'error');
      }
    } catch (e) {
      toast.show(`Authored run failed: ${String(e)}`, 'error');
    } finally {
      setRunBusy(false);
    }
  };

  const activePools = (pools ?? []).filter((p) => p.status === 'active');
  // Periods the active pools' capture rules touch — deriving them via a dry-run
  // is heavy; instead offer the engine's billing periods (the same set the run
  // console uses), scoped to the global POV year (GP6). The parent derives them
  // once and passes them down; when the year has no data they fall back to all
  // months and the PovChip flags the divergence.
  const [runPeriod, setRunPeriod] = useState('');
  useEffect(() => {
    setRunPeriod((cur) => (cur && periods.includes(cur) ? cur : defaultPeriod));
  }, [periods, defaultPeriod]);

  const canSubmit = !!editingId && (pools ?? []).find((p) => p.id === editingId)?.status === 'tested';

  // ----------------------------------------------------------------- render --

  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        Build a cost-to-charge <b>pool</b> from cost centers / profit centers / GL accounts, key it,
        exclude shareholder costs and price it per jurisdiction — then test it through the REAL Stages
        1-7 in isolation and submit for activation (maker-checker). Authored pools are governed
        <b> experiments</b> flagged <AuthoredChip /> — they run through the engine but never touch the
        governed seeded allocation (cent-exact to the warehouse).
      </Alert>

      {/* ---------------- the builder form ---------------- */}
      <Paper ref={formRef} variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, flex: 1 }}>
            {editingId ? `Editing ${editingId}` : 'New authored pool'}
          </Typography>
          {editingId && (
            <Button size="small" onClick={resetForm}>
              New pool
            </Button>
          )}
        </Stack>

        {/* (1) metadata */}
        <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
          1 · Pool metadata
        </Typography>
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1.5, mt: 0.5, mb: 2 }}>
          <TextField
            size="small"
            label="Pool name"
            value={s.name}
            onChange={(e) => set('name', e.target.value)}
            sx={{ minWidth: 240, flex: 1 }}
          />
          <TextField
            select
            size="small"
            label="Provider"
            value={s.provider}
            onChange={(e) => set('provider', e.target.value)}
            sx={{ minWidth: 240 }}
          >
            {entities.map((en) => (
              <MenuItem key={en.entity_id} value={en.entity_id}>
                {en.entity_id} · {en.legal_entity_name} ({en.jurisdiction})
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Service line"
            value={s.serviceLine}
            onChange={(e) => set('serviceLine', e.target.value)}
            sx={{ minWidth: 160 }}
          />
          <TextField
            size="small"
            label="Characterization"
            value={s.characterization}
            onChange={(e) => set('characterization', e.target.value)}
            sx={{ minWidth: 200 }}
          />
          <TextField
            size="small"
            label="Cost-base definition"
            value={s.costBase}
            onChange={(e) => set('costBase', e.target.value)}
            sx={{ minWidth: 220, flex: 1 }}
          />
        </Stack>

        {/* (2) cost-capture rule + live preview */}
        <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
          2 · Cost-capture rule
        </Typography>
        {dims === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={20} /></Box>
        ) : (
          <Stack spacing={1.5} sx={{ mt: 0.5, mb: 2 }}>
            <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1.5 }}>
              <Box sx={{ flex: 1, minWidth: 220 }}>
                <DimensionPicker
                  label="Cost centers"
                  options={dims.cost_centers}
                  value={s.costCenters}
                  onChange={(v) => set('costCenters', v)}
                />
              </Box>
              <Box sx={{ flex: 1, minWidth: 220 }}>
                <DimensionPicker
                  label="Profit centers"
                  options={dims.profit_centers}
                  value={s.profitCenters}
                  onChange={(v) => set('profitCenters', v)}
                />
              </Box>
              <Box sx={{ flex: 1, minWidth: 220 }}>
                <DimensionPicker
                  label="GL accounts (cost elements)"
                  options={dims.cost_elements}
                  value={s.costElements}
                  onChange={(v) => set('costElements', v)}
                />
              </Box>
              <TextField
                size="small"
                label="Split % (optional, 0–1)"
                value={s.splitPct}
                onChange={(e) => set('splitPct', e.target.value)}
                helperText="Fraction of each matched line"
                sx={{ minWidth: 180 }}
              />
            </Stack>
            {/* live preview card */}
            {previewErr ? (
              <Alert severity="error" variant="outlined">{previewErr}</Alert>
            ) : preview ? (
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: '#F8FAFC' }}>
                <Typography variant="body2">
                  Captures <b>{fmtAmount(preview.captured_amount)}</b> across <b>{preview.line_count}</b>{' '}
                  cost line{preview.line_count === 1 ? '' : 's'} →{' '}
                  {Object.keys(preview.by_entity).length === 0 ? (
                    'no entities'
                  ) : (
                    Object.entries(preview.by_entity).map(([eid, amt], i) => (
                      <span key={eid}>
                        {i > 0 ? ', ' : ''}
                        {eid}
                        {entityName[eid] ? ` (${entityName[eid]})` : ''} {fmtAmount(amt)}
                      </span>
                    ))
                  )}
                </Typography>
              </Paper>
            ) : (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Pick at least one cost center / profit center / GL account to preview the captured cost.
              </Typography>
            )}
          </Stack>
        )}

        {/* (3) beneficiaries + (4) key */}
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
          <Box sx={{ flex: 1, minWidth: 260 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
              3 · Beneficiaries
            </Typography>
            <TextField
              select
              size="small"
              label="Beneficiaries"
              value={s.beneficiaries}
              onChange={(e) =>
                set(
                  'beneficiaries',
                  typeof e.target.value === 'string' ? [e.target.value] : (e.target.value as unknown as string[]),
                )
              }
              SelectProps={{
                multiple: true,
                renderValue: (sel) => (sel as string[]).join(', ') || '—',
              }}
              fullWidth
              sx={{ mt: 0.5 }}
            >
              {entities.map((en) => (
                <MenuItem key={en.entity_id} value={en.entity_id}>
                  {en.entity_id} · {en.legal_entity_name} ({en.jurisdiction})
                </MenuItem>
              ))}
            </TextField>
          </Box>
          <Box sx={{ minWidth: 240 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
              4 · Allocation key
            </Typography>
            <TextField
              select
              size="small"
              label="Key factor"
              value={s.keyFactor}
              onChange={(e) => set('keyFactor', e.target.value as (typeof KEY_FACTORS)[number])}
              fullWidth
              sx={{ mt: 0.5 }}
              helperText="Factor values from the warehouse; engine recomputes the total (V-K3)"
            >
              {KEY_FACTORS.map((k) => (
                <MenuItem key={k} value={k}>{k}</MenuItem>
              ))}
            </TextField>
          </Box>
        </Stack>

        {/* (5) exclusions */}
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
            5 · Exclusions
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => set('exclusions', [...s.exclusions, emptyExclusion()])}
          >
            Add
          </Button>
        </Stack>
        {s.exclusions.length > 0 && (
          <Stack spacing={1} sx={{ mb: 2 }}>
            {s.exclusions.map((ex, i) => (
              <Stack key={i} direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }} alignItems="center">
                <TextField
                  select size="small" label="Type" value={ex.type}
                  onChange={(e) => set('exclusions', s.exclusions.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}
                  sx={{ minWidth: 150 }}
                >
                  {EXCLUSION_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </TextField>
                <TextField
                  select size="small" label="Basis" value={ex.mode}
                  onChange={(e) => set('exclusions', s.exclusions.map((x, j) => (j === i ? { ...x, mode: e.target.value as 'amount' | 'pct' } : x)))}
                  sx={{ minWidth: 110 }}
                >
                  <MenuItem value="amount">Amount</MenuItem>
                  <MenuItem value="pct">Percent</MenuItem>
                </TextField>
                <TextField
                  size="small" label={ex.mode === 'amount' ? 'Amount' : 'Pct (0–1)'} value={ex.value}
                  onChange={(e) => set('exclusions', s.exclusions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  sx={{ minWidth: 130 }}
                />
                <TextField
                  size="small" label="Rationale" value={ex.basis_rationale}
                  onChange={(e) => set('exclusions', s.exclusions.map((x, j) => (j === i ? { ...x, basis_rationale: e.target.value } : x)))}
                  sx={{ minWidth: 240, flex: 1 }}
                />
                <IconButton size="small" onClick={() => set('exclusions', s.exclusions.filter((_, j) => j !== i))} aria-label="Remove exclusion">
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
        )}

        {/* (6) markup policies */}
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
            6 · Markup policies (per jurisdiction)
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => set('markups', [...s.markups, emptyMarkup()])}
          >
            Add
          </Button>
        </Stack>
        {s.markups.length === 0 ? (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 2 }}>
            Each beneficiary jurisdiction needs a policy — a missing markup BLOCKS at Stage 5 (V-M1),
            never defaulted.
          </Typography>
        ) : (
          <Stack spacing={1} sx={{ mb: 2 }}>
            {s.markups.map((m, i) => (
              <Stack key={i} direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }} alignItems="center">
                <TextField
                  size="small" label="Jurisdiction" value={m.jurisdiction}
                  onChange={(e) => set('markups', s.markups.map((x, j) => (j === i ? { ...x, jurisdiction: e.target.value } : x)))}
                  sx={{ minWidth: 130 }}
                />
                <TextField
                  size="small" label="Regime" value={m.regime}
                  onChange={(e) => set('markups', s.markups.map((x, j) => (j === i ? { ...x, regime: e.target.value } : x)))}
                  sx={{ minWidth: 150 }}
                />
                <TextField
                  size="small" label="Markup % (0–1)" value={m.markup_pct}
                  onChange={(e) => set('markups', s.markups.map((x, j) => (j === i ? { ...x, markup_pct: e.target.value } : x)))}
                  sx={{ minWidth: 130 }}
                />
                <TextField
                  size="small" label="Benchmark study (optional)" value={m.benchmark_study_ref}
                  onChange={(e) => set('markups', s.markups.map((x, j) => (j === i ? { ...x, benchmark_study_ref: e.target.value } : x)))}
                  sx={{ minWidth: 200, flex: 1 }}
                />
                <IconButton size="small" onClick={() => set('markups', s.markups.filter((_, j) => j !== i))} aria-label="Remove markup">
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
        )}

        <Divider sx={{ my: 1.5 }} />

        {/* (7) actions */}
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button
            variant="contained"
            size="small"
            startIcon={busy === 'test' ? <CircularProgress size={14} color="inherit" /> : <ScienceIcon />}
            disabled={busy !== null}
            onClick={() => void testRun()}
          >
            {busy === 'test' ? 'Testing…' : 'Test run'}
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={busy === 'save' ? <CircularProgress size={14} color="inherit" /> : <SaveOutlinedIcon />}
            disabled={busy !== null}
            onClick={() => void saveDraft()}
          >
            Save draft
          </Button>
          <Button
            variant="outlined"
            size="small"
            color="warning"
            startIcon={busy === 'submit' ? <CircularProgress size={14} color="inherit" /> : <SendOutlinedIcon />}
            disabled={busy !== null || !canSubmit}
            onClick={() => void submitForActivation()}
          >
            Submit for activation
          </Button>
          {!canSubmit && editingId && (
            <Typography variant="caption" sx={{ color: 'text.secondary', alignSelf: 'center' }}>
              Pass a test run first — only a tested pool can be submitted.
            </Typography>
          )}
        </Stack>

        {dryRun && (
          <Box sx={{ mt: 2 }}>
            <DryRunResult dry={dryRun} entityName={entityName} />
          </Box>
        )}
      </Paper>

      {/* ---------------- authored-pool list ---------------- */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, flex: 1 }}>
            Authored pools
          </Typography>
          <AuthoredChip />
          <ProvenanceChip
            source="authored_pools"
            kind="fabricated"
            tooltip="Authored pools are governed experiments — open the Provenance dashboard"
            onClick={() => navigate('/calc-studio/provenance')}
          />
        </Stack>
        {pools === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={20} /></Box>
        ) : pools.length === 0 ? (
          <Alert severity="info" variant="outlined">
            No authored pools yet — build one above, test it and submit for activation.
          </Alert>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Pool</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Provider</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Version</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pools.map((p) => (
                  <TableRow key={p.id} hover selected={editingId === p.id}>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>{p.id}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {p.definition.provider_entity_id}
                      {entityName[p.definition.provider_entity_id] ? ` · ${entityName[p.definition.provider_entity_id]}` : ''}
                    </TableCell>
                    <TableCell><LifecycleChip status={p.status} /></TableCell>
                    <TableCell align="right">{p.version}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
                        <Button size="small" onClick={() => loadIntoForm(p)}>
                          {p.status === 'active' ? 'View' : 'Edit'}
                        </Button>
                        <HistoryButton recordRef={`allocpool:${p.id}`} />
                        {(p.status === 'draft' || p.status === 'tested') && (
                          <IconButton size="small" onClick={() => void deletePool(p)} aria-label="Delete pool">
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* ---------------- run authored allocation ---------------- */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            Run authored allocation
          </Typography>
          <AuthoredChip />
        </Stack>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
          Overlays every ACTIVE authored pool whose capture rule touches the period through the real
          Stages 1-7 in isolation, persisted + flagged authored. The governed seeded allocation is
          untouched. {activePools.length} active pool{activePools.length === 1 ? '' : 's'}.
        </Typography>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
          <TextField
            select size="small" label="Period" value={runPeriod}
            onChange={(e) => setRunPeriod(e.target.value)} sx={{ minWidth: 140 }}
          >
            {periods.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
          </TextField>
          <PovChip pinnedYear={Number(runPeriod.slice(0, 4)) || undefined} />
          <Button
            variant="contained"
            size="small"
            disabled={runBusy || activePools.length === 0}
            startIcon={runBusy ? <CircularProgress size={14} color="inherit" /> : <PlayArrowIcon />}
            onClick={() => void runAuthored(runPeriod)}
          >
            {runBusy ? 'Running…' : 'Run authored allocation'}
          </Button>
          {activePools.length === 0 && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              No active pools — activate a tested pool (via the /review queue) first.
            </Typography>
          )}
        </Stack>

        {runResult && (
          <Box sx={{ mt: 2 }}>
            <Alert
              severity={runResult.summary.status === 'succeeded' ? 'success' : 'error'}
              variant="outlined"
              action={
                <Button
                  color="inherit" size="small"
                  onClick={() => navigate(`/evidence/${encodeURIComponent(`allocation:${runResult.run_id}`)}`)}
                >
                  Run audit
                </Button>
              }
            >
              {runResult.run_id} — {runResult.summary.status} · pools{' '}
              {(runResult.summary.authored_pool_ids ?? []).join(', ') || '—'} ·{' '}
              {runResult.summary.charges} charge(s) · {fmtAmount(runResult.summary.total_charged_out)} charged out
            </Alert>
            {runResult.recon.length > 0 && (
              <TableContainer component={Paper} variant="outlined" sx={{ mt: 1.5 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Pool</TableCell>
                      <TableCell>Provider</TableCell>
                      <TableCell>Period</TableCell>
                      <TableCell align="right">Pooled</TableCell>
                      <TableCell align="right">Recovered</TableCell>
                      <TableCell align="right">Markup</TableCell>
                      <TableCell align="right">Charged out</TableCell>
                      <TableCell align="right">Residual</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {runResult.recon.map((r) => (
                      <TableRow key={r.recon_id} hover>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{r.pool_id}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {r.provider_entity_id}
                          {entityName[r.provider_entity_id] ? ` · ${entityName[r.provider_entity_id]}` : ''}
                        </TableCell>
                        <TableCell>{r.period}</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtAmount(r.total_pooled_cost)}</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtAmount(r.total_cost_recovered)}</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtAmount(r.total_markup)}</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtAmount(r.total_charged_out)}</TableCell>
                        <TableCell
                          align="right"
                          sx={{
                            fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: 700,
                            color: isNonZero(r.unallocated_residual) ? 'error.main' : 'success.main',
                          }}
                        >
                          {fmtAmount(r.unallocated_residual)}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            color={r.recon_status === 'Balanced' ? 'success' : 'error'}
                            label={r.recon_status}
                            sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        )}
      </Paper>
    </Stack>
  );
}
