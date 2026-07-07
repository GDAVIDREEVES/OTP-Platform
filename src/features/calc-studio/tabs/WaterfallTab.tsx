import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ReplayIcon from '@mui/icons-material/Replay';
import { api } from '@/shared/api/client';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useToast } from '@/shared/providers/DataProvider';
import { useRefreshSignals } from '@/shared/providers/WorkSignalsProvider';
import type { Parameter, PlAdjusted, PlAdjustedRow, WaterfallRun } from '@/shared/api/types';
import { fmtAmount, isNonZero, sumCents } from '../allocationLib';

/** Waterfall — the TP calculation sequence console (Phase 5 W2).
 *
 *  Runs the ordered charge waterfall (service_allocation → royalties →
 *  csa_true_up → profit_split) against the append-only pl_overlays ledger
 *  (POST /api/waterfall/runs), shows each step's status + applied amounts,
 *  rolls an applied run back via REVERSING rows, and reads the per-entity
 *  impact off GET /api/pl/adjusted (base | overlay | post-charge, with
 *  per-line provenance). The governed pl.use_post_charge parameter — edited
 *  here as a switch, hash-chained at param:pl.use_post_charge — flips the
 *  OTP-20/16/1 margin reads (/api/margins/trend, /api/kpis, /api/forecast)
 *  to the post-charge basis server-side. Overlay amounts are exact decimal
 *  strings rendered lexically (../allocationLib.ts) — no float math. */

const YEAR = 2026;
const PARAM_KEY = 'pl.use_post_charge';

const STATUS_COLOR: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  applied: 'success',
  failed: 'error',
  running: 'warning',
  rolled_back: 'default',
  superseded: 'default',
};

function RunStatusChip({ status }: { status: string }) {
  return (
    <Chip
      size="small"
      color={STATUS_COLOR[status] ?? 'default'}
      label={status}
      sx={{ height: 20, fontSize: 11 }}
    />
  );
}

const fmtMargin = (m: number | null) => (m == null ? '—' : `${(m * 100).toFixed(2)}%`);

/** Per-kind overlay breakdown for the provenance tooltip on an impact row. */
function byKindText(row: PlAdjustedRow): string {
  const kinds = Object.entries(row.overlay.by_kind)
    .filter(([, v]) => isNonZero(v.revenue) || isNonZero(v.cost))
    .map(([k, v]) => `${k}: net ${fmtAmount(v.net)}`);
  return kinds.length ? kinds.join(' · ') : 'no applied overlay';
}

// --------------------------------------------------- governed basis toggle --

function BasisToggle({
  appliedRunId, onChanged,
}: {
  appliedRunId: string | null;
  onChanged: () => void;
}) {
  const user = useSessionUser();
  const toast = useToast();
  const navigate = useNavigate();
  const refreshSignals = useRefreshSignals();
  const [param, setParam] = useState<Parameter | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => {
    api.parameter(PARAM_KEY).then(setParam).catch(() => setParam(null));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const on = param?.value === true;

  const flip = async (next: boolean) => {
    setSaving(true);
    try {
      await api.patchParameter(PARAM_KEY, {
        value: next,
        actor: user.id,
        rationale: next
          ? 'Switch the OTP-20/16/1 margin reads to the post-charge P&L basis'
          : 'Return the OTP-20/16/1 margin reads to the base P&L basis',
      });
      toast.show(
        `Post-charge basis ${next ? 'enabled' : 'disabled'} — recorded at param:${PARAM_KEY}`,
        'success',
      );
      refresh();
      onChanged();
      void refreshSignals(); // close-status basis chip / home Command Center
    } catch (e) {
      toast.show(`Toggle failed: ${String(e)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Governed post-charge toggle
            <Typography component="span" variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary', ml: 1 }}>
              {PARAM_KEY}
            </Typography>
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            When on, the OTP-20 monitoring / OTP-16 adjustment / OTP-1 pricing reads (margins, KPIs,
            forecast) resolve to the post-charge P&L server-side. Edits hash-chain at{' '}
            param:{PARAM_KEY}. Base stays in force until a waterfall run is applied.
          </Typography>
          {on && appliedRunId == null && (
            <Alert severity="warning" variant="outlined" sx={{ mt: 1, py: 0 }}>
              The toggle is on but no waterfall run is applied — every read stays on the base P&L.
            </Alert>
          )}
        </Box>
        <FormControlLabel
          control={(
            <Switch
              checked={on}
              disabled={param === null || saving}
              onChange={(_, next) => void flip(next)}
            />
          )}
          label={on ? 'Post-charge' : 'Base'}
        />
        <Button
          size="small"
          onClick={() => navigate(`/evidence/${encodeURIComponent(`param:${PARAM_KEY}`)}`)}
        >
          Audit
        </Button>
      </Stack>
    </Paper>
  );
}

// ------------------------------------------------------------------- the tab --

export default function WaterfallTab() {
  const user = useSessionUser();
  const toast = useToast();
  const navigate = useNavigate();
  const refreshSignals = useRefreshSignals();
  const [runs, setRuns] = useState<WaterfallRun[] | null>(null);
  const [adjusted, setAdjusted] = useState<PlAdjusted | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api.waterfallRuns().then((rs) => setRuns([...rs].reverse())).catch(() => setRuns([]));
    api.plAdjusted({ year: YEAR }).then(setAdjusted).catch(() => setAdjusted(null));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const actor = user.id;
  const appliedRunId = adjusted?.applied_run_id ?? null;
  const latest = runs?.[0] ?? null;

  const launch = async () => {
    setBusy(true);
    try {
      const run = await api.runWaterfall({ actor, year: YEAR });
      toast.show(
        run.status === 'applied'
          ? `Waterfall ${run.id} applied — audited at waterfall:${run.id}`
          : `Waterfall ${run.id} ${run.status}: ${run.error ?? 'see step detail'}`,
        run.status === 'applied' ? 'success' : 'error',
      );
      refresh();
      void refreshSignals(); // waterfall close step / home Command Center
    } catch (e) {
      toast.show(`Run failed: ${String(e)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (runId: string) => {
    setBusy(true);
    try {
      const res = await api.rollbackWaterfall(runId, { actor });
      toast.show(`${runId} rolled back — ${res.reversed_lines} reversing rows appended`, 'success');
      refresh();
      void refreshSignals(); // waterfall close step / home Command Center
    } catch (e) {
      toast.show(`Rollback failed: ${String(e)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (runs === null) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  }

  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        The TP calculation waterfall — charges are computed and <b>applied</b> to each entity P&L
        before TP decisions: <b>service allocation → royalties → CSA true-up → profit split</b>.
        Every applied charge is a double-entry line on the append-only overlay ledger (provider
        revenue+ / recipient cost+, group nets to zero); corrections and rollbacks are reversing
        rows. Runs hash-chain at <b>waterfall:&#123;id&#125;</b>, lines at <b>overlay:&#123;id&#125;</b>.
      </Alert>

      <BasisToggle appliedRunId={appliedRunId} onChanged={refresh} />

      {/* ---- run console ---- */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Run console</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              FY {YEAR} · at most one run is applied at a time — a new run supersedes the prior one.
            </Typography>
          </Box>
          <Button
            variant="contained"
            size="small"
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <PlayArrowIcon />}
            disabled={busy}
            onClick={() => void launch()}
          >
            Run waterfall
          </Button>
        </Stack>
        {runs.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No runs yet — press “Run waterfall” to compute and apply the full charge sequence.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Run</TableCell>
                  <TableCell>Started</TableCell>
                  <TableCell>Actor</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Lines</TableCell>
                  <TableCell align="right">Applied amount</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {runs.map((r) => {
                  const lines = r.steps.reduce((a, s) => a + (s.lines ?? 0), 0);
                  return (
                    <TableRow key={r.id} hover selected={r.id === appliedRunId}>
                      <TableCell sx={{ fontWeight: 700 }}>{r.id}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {new Date(r.started_at).toLocaleString()}
                      </TableCell>
                      <TableCell>{r.actor}</TableCell>
                      <TableCell><RunStatusChip status={r.status} /></TableCell>
                      <TableCell align="right">{lines || '—'}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {/* Σ step revenue side == Σ cost side (double entry) —
                            exact BigInt-cents sum, no float math */}
                        {r.steps.some((s) => s.revenue_total)
                          ? fmtAmount(sumCents(r.steps.map((s) => s.revenue_total)))
                          : '—'}
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          {r.status === 'applied' && (
                            <Button
                              size="small"
                              color="warning"
                              startIcon={<ReplayIcon />}
                              disabled={busy}
                              onClick={() => void rollback(r.id)}
                            >
                              Rollback
                            </Button>
                          )}
                          <Button
                            size="small"
                            onClick={() => navigate(`/evidence/${encodeURIComponent(`waterfall:${r.id}`)}`)}
                          >
                            Evidence
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* ---- sequence console: the latest run's steps ---- */}
      {latest && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
            Sequence — {latest.id} <RunStatusChip status={latest.status} />
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Step</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Lines</TableCell>
                  <TableCell align="right">Applied amount</TableCell>
                  <TableCell align="right">Net</TableCell>
                  <TableCell>Detail</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {latest.steps.map((s, i) => (
                  <TableRow key={s.id} hover>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{s.label ?? s.id}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                        {s.id}
                      </Typography>
                    </TableCell>
                    <TableCell><RunStatusChip status={s.status} /></TableCell>
                    <TableCell align="right">{s.lines ?? '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {fmtAmount(s.revenue_total)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {fmtAmount(s.net)}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 260 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
                        {s.error
                          ? s.error
                          : s.billing_periods
                            ? `billing periods ${s.billing_periods.join(', ')}`
                            : '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* ---- per-entity impact (GET /api/pl/adjusted) ---- */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Per-entity impact — base | IC charges | post-charge
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              GET /api/pl/adjusted · overlay amounts are exact decimal strings off the ledger.
            </Typography>
          </Box>
          {appliedRunId ? (
            <Chip size="small" color="success" label={`${appliedRunId} applied`} sx={{ height: 22 }} />
          ) : (
            <Chip size="small" label="no waterfall applied — post-charge equals base" sx={{ height: 22 }} />
          )}
        </Stack>
        {adjusted === null ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Impact unavailable.</Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Entity</TableCell>
                  <TableCell align="right">Base OP</TableCell>
                  <TableCell align="right">Base OM</TableCell>
                  <TableCell align="right">IC revenue +</TableCell>
                  <TableCell align="right">IC cost +</TableCell>
                  <TableCell align="right">Net charge</TableCell>
                  <TableCell align="right">Post-charge OP</TableCell>
                  <TableCell align="right">Post-charge OM</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {adjusted.rows.map((row) => {
                  const changed = isNonZero(row.overlay.revenue) || isNonZero(row.overlay.cost);
                  return (
                    <TableRow key={row.entity} hover>
                      <TableCell sx={{ fontWeight: 700 }}>{row.entity}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtAmount(row.base.operating_profit.toFixed(2))}
                      </TableCell>
                      <TableCell align="right">{fmtMargin(row.base.operating_margin)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtAmount(row.overlay.revenue)}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtAmount(row.overlay.cost)}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: changed ? 700 : 400 }}>
                        <Tooltip title={byKindText(row)} arrow>
                          <span>{fmtAmount(row.overlay.net)}</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: changed ? 700 : 400 }}>
                        {fmtAmount(row.post_charge.operating_profit.toFixed(2))}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: changed ? 700 : 400 }}>
                        {fmtMargin(row.post_charge.operating_margin)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Stack>
  );
}
