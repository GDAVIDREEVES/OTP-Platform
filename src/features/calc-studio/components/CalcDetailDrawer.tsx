import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { api } from '@/shared/api/client';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { usePov } from '@/shared/hooks/usePov';
import PovChip from '@/shared/components/PovChip';
import type { CalcDefResolved, CalcRun, CalcRunResult, ShapedStep } from '@/shared/api/types';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import { HistoryButton } from '@/kernel/audit/HistoryDrawer';
import LifecycleChip from '@/shared/components/LifecycleChip';
import { provKind, shapeTermSteps, valueText, PROV_META } from '../lib';
import TraceTree from './TraceTree';
import RuleCard from './RuleCard';

/** One label/value cell in the metadata grid. */
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{value}</Typography>
    </Box>
  );
}

/** Calculation detail drawer (shell cloned from CaseDrawer): the registry
 *  definition (description + formula + rule cards), its resolved inputs
 *  (catalog entries with provenance + governed parameters with current
 *  values), the per-calc run history, a "Run now" action and the shaped
 *  trace tree (CS-d) — fresh runs show the richest trace straight from the
 *  POST response; "View trace" shapes any past run retroactively. Every run
 *  persists to calc_runs and hash-chains a "run" event at
 *  record_ref="calc:{id}", so the evidence packet lights up automatically.
 *  W4: user-defined calcs reuse this drawer unchanged — the definition shows
 *  the authored formula, Inputs show its resolved terms; their runs audit at
 *  ucalc:{id} and have no curated shaped trace, so the raw param/measure/calc
 *  term steps are shaped client-side (shapeTermSteps). */
export default function CalcDetailDrawer({
  open,
  onClose,
  calcId,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  calcId: string | null;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  // Runs audit as the signed-in persona (GP3 — real actor, not a ghost).
  const ACTOR = useSessionUser().id;
  // The global point of view — passed to the run when the calc declares a year.
  const { year } = usePov();
  const [detail, setDetail] = useState<CalcDefResolved | null>(null);
  const [runs, setRuns] = useState<CalcRun[] | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CalcRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [trace, setTrace] = useState<{ label: string; steps: ShapedStep[] } | null>(null);

  useEffect(() => {
    setDetail(null);
    setRuns(null);
    setResult(null);
    setRunError(null);
    setTrace(null);
    if (!calcId) return;
    api.calc(calcId).then(setDetail).catch(() => setDetail(null));
    api.calcRuns(calcId).then(setRuns).catch(() => setRuns([]));
  }, [calcId]);

  // table -> catalog id for the term-step fallback (user-defined calcs) — the
  // resolved inputs carry the real warehouse:{table} ids, nothing is invented.
  const catalogByTable: Record<string, string> = {};
  (detail?.resolved_inputs.catalog ?? []).forEach((c) => {
    if (c.id?.startsWith('warehouse:')) catalogByTable[c.id.slice('warehouse:'.length)] = c.id;
  });

  // Evidence + run events hash-chain at calc:{id} for system calcs and
  // ucalc:{id} for user-defined ones (state/user_calcs.py).
  const recordRef = detail
    ? `${detail.kind === 'user-defined' ? 'ucalc' : 'calc'}:${detail.id}`
    : null;

  // Only the seed defs whose arg schema declares `year` accept a POV year (13
  // of 15). User-defined calcs are fully declarative and REJECT any args
  // (services/calc_registry.py `_run_user`), so never pass them one — the
  // arg-schema check naturally excludes them (their args are {}).
  const declaresYear = !!detail && detail.args != null && 'year' in detail.args;

  const runNow = async () => {
    if (!calcId) return;
    setRunning(true);
    setResult(null);
    setRunError(null);
    try {
      const res = await api.runCalc(
        calcId,
        declaresYear ? { actor: ACTOR, args: { year } } : { actor: ACTOR },
      );
      setResult(res);
      setTrace({
        label: `Run #${res.id} — just now`,
        // User-defined calcs have no curated shape — their raw term steps ARE
        // the explanation (param/measure/calc values the engine read).
        steps: res.shaped_trace?.length
          ? res.shaped_trace
          : shapeTermSteps(res.trace ?? [], catalogByTable),
      });
      const fresh = await api.calcRuns(calcId);
      setRuns(fresh);
      onChanged();
    } catch (e) {
      setRunError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const viewTrace = async (r: CalcRun) => {
    setRunError(null);
    try {
      const shaped = await api.shapedRun(r.id);
      setTrace({
        label: `Run #${r.id} — ${new Date(r.ts).toLocaleString()}`,
        steps: shaped.shaped_trace.length
          ? shaped.shaped_trace
          : shapeTermSteps(shaped.trace, catalogByTable),
      });
    } catch (e) {
      setRunError(String(e));
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 660 } } }}>
      <Box sx={{ p: 2 }}>
        <Stack direction="row" alignItems="flex-start" sx={{ mb: 1.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>
              Calculation registry
            </Typography>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                {detail?.name ?? calcId ?? '—'}
              </Typography>
              {detail && (
                <>
                  <Chip size="small" label={detail.type} sx={{ height: 22 }} />
                  <Chip
                    size="small"
                    variant="outlined"
                    color={detail.kind === 'user-defined' ? 'secondary' : 'default'}
                    label={detail.kind}
                    sx={{ height: 22 }}
                  />
                  <Chip size="small" variant="outlined" label={`v${detail.version}`} sx={{ height: 22 }} />
                  <LifecycleChip status={detail.status} />
                </>
              )}
            </Stack>
          </Box>
          {recordRef && <HistoryButton recordRef={recordRef} size="medium" />}
          <IconButton onClick={onClose} aria-label="Close">
            <CloseIcon />
          </IconButton>
        </Stack>

        {!calcId ? null : detail === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        ) : (
          <Stack spacing={2.5}>
            {/* Metadata grid */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}>
              <Meta label="Process" value={detail.process_id} />
              <Meta label="Owner" value={detail.owner} />
              <Meta label="Endpoint" value={detail.endpoint ?? 'expression engine (no HTTP endpoint)'} />
              <Meta label="Scenarios" value={detail.scenario_capable ? 'scenario-capable' : 'not scenario-capable'} />
            </Box>

            <Divider />

            {/* Definition */}
            <Box>
              <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                Definition
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                {detail.description}
              </Typography>
              <Box
                sx={{
                  fontFamily: 'monospace',
                  fontSize: 12.5,
                  bgcolor: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: 1,
                  p: 1.5,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                }}
              >
                {detail.formula}
              </Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                {detail.output}
              </Typography>
              {/* Structured rule cards for the parameter-backed rules (CS-d). */}
              <RuleCard parameters={detail.resolved_inputs.parameters} />
            </Box>

            <Divider />

            {/* Inputs — catalog sources + governed parameters */}
            <Box>
              <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                Inputs
              </Typography>
              <Stack spacing={1}>
                {detail.resolved_inputs.catalog.map((c) => (
                  <Stack key={c.id} direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                    <ProvenanceChip
                      source={c.provenance ?? 'assumed'}
                      kind={provKind(c.provenance)}
                      tooltip={PROV_META[provKind(c.provenance)].hint}
                    />
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{c.name}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                      {c.description ?? ''}
                    </Typography>
                  </Stack>
                ))}
                {detail.resolved_inputs.parameters.map((p) => (
                  <Stack key={p.key} direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                    <ProvenanceChip
                      source={p.provenance ?? 'assumed'}
                      kind={provKind(p.provenance)}
                      tooltip={PROV_META[provKind(p.provenance)].hint}
                    />
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{p.key}</Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
                      {valueText(p.value)}
                    </Typography>
                    <Button
                      size="small"
                      onClick={() => navigate(`/evidence/${encodeURIComponent(`param:${p.key}`)}`)}
                    >
                      Audit
                    </Button>
                  </Stack>
                ))}
              </Stack>
            </Box>

            <Divider />

            {/* Run now */}
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                <Button
                  variant="contained"
                  startIcon={running ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
                  onClick={() => void runNow()}
                  disabled={running}
                >
                  {running ? 'Running…' : 'Run now'}
                </Button>
                {declaresYear && <PovChip />}
              </Stack>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Runs the live handler{declaresYear ? ` for FY${year}` : ''}, persists digest + summary
                + trace, and hash-chains a run event at {recordRef}.
              </Typography>
              {result && (
                <Alert severity="success" variant="outlined" onClose={() => setResult(null)}>
                  Run #{result.id} succeeded in {result.duration_ms ?? 0} ms — digest{' '}
                  <Box component="span" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                    {(result.output_digest ?? '').slice(0, 12)}
                  </Box>
                  . Recorded at {recordRef}.
                </Alert>
              )}
              {runError && (
                <Alert severity="error" variant="outlined" onClose={() => setRunError(null)}>
                  Run failed: {runError}
                </Alert>
              )}
            </Stack>

            <Divider />

            {/* Run history */}
            <Box>
              <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                Runs
              </Typography>
              {runs === null ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={20} /></Box>
              ) : runs.length === 0 ? (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Never run — press “Run now” to record the first run.
                </Typography>
              ) : (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Ran at</TableCell>
                        <TableCell>Actor</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell align="right">Duration</TableCell>
                        <TableCell>Digest</TableCell>
                        <TableCell align="right">Trace</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {runs.map((r) => (
                        <TableRow key={r.id} hover>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(r.ts).toLocaleString()}</TableCell>
                          <TableCell>{r.actor}</TableCell>
                          <TableCell>
                            <LifecycleChip status={r.status} />
                          </TableCell>
                          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                            {r.duration_ms != null ? `${r.duration_ms} ms` : '—'}
                          </TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                            {r.output_digest ? r.output_digest.slice(0, 12) : '—'}
                          </TableCell>
                          <TableCell align="right">
                            <Button size="small" onClick={() => void viewTrace(r)}>
                              View trace
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Box>

            <Divider />

            {/* Trace — the shaped explain-steps (CS-d) */}
            <Box>
              <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                Trace
              </Typography>
              {trace === null ? (
                <Alert severity="info" variant="outlined">
                  Press “Run now” for the freshest trace (per-participant figures) or “View trace” on a
                  past run — every run persists its raw steps, so historical runs shape retroactively.
                </Alert>
              ) : (
                <Stack spacing={1}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {trace.label}
                  </Typography>
                  <TraceTree steps={trace.steps} />
                </Stack>
              )}
            </Box>

            <Divider />

            {/* Evidence packet — the hash-chained history at calc:{id} (system)
                or ucalc:{id} (user-defined: full authoring changelog + runs) */}
            <Stack spacing={0.5}>
              <Button
                variant="outlined"
                startIcon={<DescriptionOutlinedIcon />}
                onClick={() => navigate(`/evidence/${encodeURIComponent(recordRef ?? `calc:${detail.id}`)}`)}
                sx={{ alignSelf: 'flex-start' }}
              >
                Evidence packet
              </Button>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {detail.kind === 'user-defined'
                  ? `The full authoring changelog + every run event, hash-chained at ${recordRef}.`
                  : `Every run event, hash-chained at ${recordRef}.`}
              </Typography>
            </Stack>
          </Stack>
        )}
      </Box>
    </Drawer>
  );
}
