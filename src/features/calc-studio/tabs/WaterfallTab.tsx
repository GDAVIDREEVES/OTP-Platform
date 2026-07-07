import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ReplayIcon from '@mui/icons-material/Replay';
import { api } from '@/shared/api/client';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useToast } from '@/shared/providers/DataProvider';
import { useRefreshSignals } from '@/shared/providers/WorkSignalsProvider';
import { useReviewHandoff } from '@/kernel/review/ReviewHandoff';
import LifecycleChip from '@/shared/components/LifecycleChip';
import type {
  Parameter, PlAdjusted, PlAdjustedRow, WaterfallRequest, WaterfallRun,
} from '@/shared/api/types';
import { fmtAmount, isNonZero, sumCents } from '../allocationLib';

/** Waterfall — the TP calculation sequence console (Phase 5 W2; GP4 governance).
 *
 *  The waterfall (service_allocation → royalties → csa_true_up → profit_split)
 *  rewrites the group segmented P&L via the append-only pl_overlays ledger — the
 *  platform's highest-impact write. So running or rolling it back does NOT
 *  execute on a click: it SUBMITS a maker-checker request (POST
 *  /api/waterfall/requests) that enqueues one review item at waterfall:{id}; a
 *  DIFFERENT reviewer approving it in /review is what actually runs (or reverses)
 *  it — execute-on-approve, the same gate scenario promotion uses. The run
 *  console then shows each applied step + amounts off GET /api/pl/adjusted (base
 *  | overlay | post-charge, with per-line provenance). The governed
 *  pl.use_post_charge parameter — edited here as a switch behind a confirm
 *  dialog, hash-chained at param:pl.use_post_charge — flips the OTP-20/16/1
 *  margin reads (/api/margins/trend, /api/kpis, /api/forecast) to the
 *  post-charge basis server-side. Overlay amounts are exact decimal strings
 *  rendered lexically (../allocationLib.ts) — no float math. */

const YEAR = 2026;
const PARAM_KEY = 'pl.use_post_charge';
const WATERFALL_PROCESS = 'OTP-21';

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

/** The margin surfaces the governed basis toggle repaints platform-wide — shown
 *  in the confirm dialog so the ceremony matches the blast radius. */
const BASIS_BLAST_RADIUS = [
  'OTP-20 monitoring — margin trend & exception bands',
  'OTP-16 adjustments — in-range / out-of-range basis',
  'Home KPIs (/api/kpis)',
  'Forecast (/api/forecast)',
  'Segmented P&L reads across the platform',
];

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
  // The pending flip awaiting confirmation (target value + a required rationale).
  const [confirm, setConfirm] = useState<{ next: boolean } | null>(null);
  const [rationale, setRationale] = useState('');

  const refresh = useCallback(() => {
    api.parameter(PARAM_KEY).then(setParam).catch(() => setParam(null));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const on = param?.value === true;

  const flip = async () => {
    if (!confirm || !rationale.trim()) return;
    const next = confirm.next;
    setSaving(true);
    try {
      await api.patchParameter(PARAM_KEY, {
        value: next,
        actor: user.id,
        rationale: rationale.trim(),
      });
      toast.show(
        `Post-charge basis ${next ? 'enabled' : 'disabled'} — recorded at param:${PARAM_KEY}`,
        'success',
      );
      setConfirm(null);
      setRationale('');
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
              // Don't flip instantly — this repaints every margin surface
              // platform-wide, so require a confirm + rationale first.
              onChange={(_, next) => { setConfirm({ next }); setRationale(''); }}
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

      <Dialog open={confirm !== null} onClose={saving ? undefined : () => setConfirm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {confirm?.next ? 'Switch reporting basis to post-charge?' : 'Return reporting basis to base?'}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <Typography variant="body2">
              This governed change repaints <b>every margin surface</b> across the platform at once —
              it does not just affect this tab:
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {BASIS_BLAST_RADIUS.map((s) => (
                <Typography component="li" variant="body2" key={s} sx={{ color: 'text.secondary' }}>
                  {s}
                </Typography>
              ))}
            </Box>
            <Alert severity="info" variant="outlined" sx={{ py: 0 }}>
              Edit hash-chains at <b>param:{PARAM_KEY}</b>. The rationale below is recorded on the
              audit trail.
            </Alert>
            <TextField
              autoFocus
              fullWidth
              multiline
              minRows={2}
              label="Rationale (required)"
              placeholder={confirm?.next
                ? 'Why switch reporting to the post-charge basis now?'
                : 'Why return reporting to the base basis?'}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)} disabled={saving}>Cancel</Button>
          <Button
            variant="contained"
            color={confirm?.next ? 'primary' : 'warning'}
            onClick={() => void flip()}
            disabled={!rationale.trim() || saving}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {confirm?.next ? 'Switch to post-charge' : 'Return to base'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

// ------------------------------------------------------------------- the tab --

export default function WaterfallTab() {
  const user = useSessionUser();
  const toast = useToast();
  const navigate = useNavigate();
  const refreshSignals = useRefreshSignals();
  const { notifySubmitted } = useReviewHandoff();
  const [runs, setRuns] = useState<WaterfallRun[] | null>(null);
  const [pending, setPending] = useState<WaterfallRequest[]>([]);
  const [adjusted, setAdjusted] = useState<PlAdjusted | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api.waterfallRuns().then((rs) => setRuns([...rs].reverse())).catch(() => setRuns([]));
    api.waterfallRequests('pending').then(setPending).catch(() => setPending([]));
    api.plAdjusted({ year: YEAR }).then(setAdjusted).catch(() => setAdjusted(null));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const actor = user.id;
  const appliedRunId = adjusted?.applied_run_id ?? null;
  const latest = runs?.[0] ?? null;

  // Running / rolling back the waterfall rewrites the group P&L, so both SUBMIT
  // a maker-checker request instead of executing — a different reviewer's
  // approval in /review is what actually runs it (execute-on-approve).
  const submitRequest = async (
    body: Parameters<typeof api.createWaterfallRequest>[0],
    label: string,
  ) => {
    setBusy(true);
    try {
      const req = await api.createWaterfallRequest(body);
      toast.show(`Requested — awaiting approval (${req.record_ref})`, 'success');
      notifySubmitted({
        recordRef: req.record_ref,
        processId: WATERFALL_PROCESS,
        label,
      });
      refresh();
      void refreshSignals(); // bell badge / home Command Center / My work
    } catch (e) {
      toast.show(`Request failed: ${String(e)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const requestRun = () =>
    submitRequest(
      { actor, action: 'run', year: YEAR, rationale: `Run and apply the FY${YEAR} charge waterfall to the group P&L` },
      `Waterfall run — FY${YEAR}`,
    );

  const requestRollback = (runId: string) =>
    submitRequest(
      { actor, action: 'rollback', target_run_id: runId, rationale: `Roll back waterfall run ${runId}` },
      `Waterfall rollback — ${runId}`,
    );

  // A run already has a rollback request in flight → don't offer a second.
  const rollbackPendingFor = (runId: string) =>
    pending.some((p) => p.action === 'rollback' && p.target_run_id === runId);

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
        rows. Because a run <b>rewrites the group P&L</b>, running or rolling back <b>submits a
        request for approval</b> — a different reviewer must approve it in the review queue before
        anything is applied. Runs hash-chain at <b>waterfall:&#123;id&#125;</b>, lines at{' '}
        <b>overlay:&#123;id&#125;</b>.
      </Alert>

      <BasisToggle appliedRunId={appliedRunId} onChanged={refresh} />

      {/* ---- pending requests awaiting approval ---- */}
      {pending.length > 0 && (
        <Alert severity="warning" variant="outlined" icon={false}>
          <Stack spacing={1}>
            <Box sx={{ fontWeight: 700 }}>Requested — awaiting approval</Box>
            {pending.map((p) => (
              <Stack key={p.id} direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <LifecycleChip status={p.status} />
                <Box component="span">
                  {p.action === 'run'
                    ? `Run waterfall — FY${p.year}`
                    : `Rollback — ${p.target_run_id}`}
                </Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  requested by {p.requested_by} · a different reviewer must approve
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => navigate('/review')}
                >
                  Open review queue
                </Button>
              </Stack>
            ))}
          </Stack>
        </Alert>
      )}

      {/* ---- run console ---- */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Run console</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              FY {YEAR} · at most one run is applied at a time — a new run supersedes the prior one.
              Runs are applied only after a reviewer approves the request.
            </Typography>
          </Box>
          <Button
            variant="contained"
            size="small"
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <PlayArrowIcon />}
            disabled={busy}
            onClick={() => void requestRun()}
          >
            Request run
          </Button>
        </Stack>
        {runs.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No runs yet — press “Request run” to submit the charge sequence for approval; it applies
            once a reviewer approves.
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
                            <Tooltip title={rollbackPendingFor(r.id) ? 'A rollback request is already awaiting approval' : ''}>
                              <span>
                                <Button
                                  size="small"
                                  color="warning"
                                  startIcon={<ReplayIcon />}
                                  disabled={busy || rollbackPendingFor(r.id)}
                                  onClick={() => void requestRollback(r.id)}
                                >
                                  Request rollback
                                </Button>
                              </span>
                            </Tooltip>
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
