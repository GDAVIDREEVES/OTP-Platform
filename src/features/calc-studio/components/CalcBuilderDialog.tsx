import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, List, ListItemButton, MenuItem, Paper, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PreviewOutlinedIcon from '@mui/icons-material/PreviewOutlined';
import { api } from '@/shared/api/client';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useToast } from '@/shared/providers/DataProvider';
import type {
  CalcDef, ExprResult, ExprValidation, ShapedStep, UserCalc, UserCalcTerms,
} from '@/shared/api/types';
import type { ProcessDef } from '@/kernel/registry/types';
import { shapeTermSteps, valueText, useParameters } from '../lib';
import TraceTree from './TraceTree';

/** Calculation Builder (W4) — author a calculation from scratch against the
 *  safe expression engine (backend/calc/expr.py — no eval/exec, Decimal
 *  money). Term pickers (governed parameters, the warehouse measure allowlist,
 *  composable system calcs) INSERT tokens into the formula bar at the cursor;
 *  every keystroke validates via POST /api/user-calcs/validate (errors shown
 *  inline, all at once); Preview evaluates via POST /api/user-calcs/preview —
 *  result rows + a TraceTree of the term values the engine actually read,
 *  nothing persisted. Lifecycle: Save draft → Test run (the activation gate)
 *  → Submit for activation (maker-checker: a DIFFERENT reviewer approves the
 *  ucalc:{id} item in /review). Every mutation is hash-chained at ucalc:{id}. */

const DEFAULT_PROCESS = 'OTP-49'; // the governance console — backend default

const STATUS_HINT: Record<UserCalc['status'], string> = {
  draft: 'Draft — test-run the formula to unlock activation.',
  tested: 'Tested — submit for activation (a different reviewer approves).',
  in_review: 'In review — frozen until the checker decides in /review.',
  active: 'Active — editing creates a new draft version (re-test + re-approval).',
};

/** Render an evaluated expression: a scalar figure at 'group' grain, otherwise
 *  the grained rows (+ exact total) straight from the API. */
function ResultView({ result }: { result: ExprResult }) {
  if (!result.rows) {
    return (
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="overline" sx={{ color: 'text.secondary' }}>
          Result — {result.grain} grain
        </Typography>
        <Typography variant="h6" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
          {result.value_exact ?? valueText(result.value)}
        </Typography>
        {result.value_exact && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            exact decimal — floats never touch the math
          </Typography>
        )}
      </Paper>
    );
  }
  const keyCols = Object.keys(result.rows[0] ?? {}).filter(
    (k) => k !== 'value' && k !== 'value_exact'
  );
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 260 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {keyCols.map((c) => <TableCell key={c}>{c}</TableCell>)}
            <TableCell align="right">Value (exact)</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {result.rows.map((r, i) => (
            <TableRow key={i} hover>
              {keyCols.map((c) => (
                <TableCell key={c} sx={{ fontFamily: 'monospace' }}>{String(r[c])}</TableCell>
              ))}
              <TableCell align="right" sx={{ fontFamily: 'monospace' }}>{r.value_exact}</TableCell>
            </TableRow>
          ))}
          {result.total_exact != null && (
            <TableRow>
              <TableCell colSpan={keyCols.length} sx={{ fontWeight: 700 }}>
                Total ({result.grain} grain, {result.rows.length} rows)
              </TableCell>
              <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                {result.total_exact}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** One term-picker panel: a titled, scrollable list of insertable tokens. */
function PickerPanel({ title, hint, children }: {
  title: string; hint: string; children: React.ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 1.5, pt: 1, pb: 0.5 }}>
        <Typography variant="overline" sx={{ color: 'text.secondary' }}>{title}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{hint}</Typography>
      </Box>
      <Box sx={{ overflowY: 'auto', maxHeight: 190 }}>{children}</Box>
    </Paper>
  );
}

export default function CalcBuilderDialog({
  ucalc, onClose, onSaved,
}: {
  ucalc: UserCalc | null; // null = new calculation
  onClose: () => void;
  onSaved: () => void; // server state changed — refresh the tab
}) {
  const user = useSessionUser();
  const toast = useToast();
  const { params } = useParameters();
  const [terms, setTerms] = useState<UserCalcTerms | null>(null);
  const [systemCalcs, setSystemCalcs] = useState<CalcDef[] | null>(null);
  const [processes, setProcesses] = useState<ProcessDef[] | null>(null);

  const [saved, setSaved] = useState<UserCalc | null>(ucalc);
  const [name, setName] = useState(ucalc?.name ?? '');
  const [description, setDescription] = useState(ucalc?.description ?? '');
  const [processId, setProcessId] = useState(ucalc?.process_id ?? DEFAULT_PROCESS);
  const [outputGrain, setOutputGrain] = useState(ucalc?.output_grain ?? 'group');
  const [expression, setExpression] = useState(ucalc?.expression ?? '');

  const [validation, setValidation] = useState<ExprValidation | null>(null);
  const [preview, setPreview] = useState<{ label: string; result: ExprResult; steps: ShapedStep[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | 'submit' | 'preview' | null>(null);

  const formulaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    api.userCalcTerms().then(setTerms).catch(() => setTerms(null));
    api.calcs().then(setSystemCalcs).catch(() => setSystemCalcs([]));
    api.processes().then((c) => setProcesses(c.processes)).catch(() => setProcesses([]));
  }, []);

  // Live validation — debounced; the cleanup cancels both the timer and any
  // in-flight response so stale reports never land.
  useEffect(() => {
    if (expression.trim() === '') {
      setValidation(null);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api.validateUserCalc(expression)
        .then((v) => { if (!cancelled) setValidation(v); })
        .catch(() => { if (!cancelled) setValidation(null); });
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [expression]);

  const catalogByTable = useMemo(() => {
    const map: Record<string, string> = {};
    (terms?.measures ?? []).forEach((m) => { map[m.table] = m.catalog_id; });
    return map;
  }, [terms]);

  // calc() composes registered SYSTEM calcs only, minus the ledger-writers.
  const composable = useMemo(
    () => (systemCalcs ?? []).filter(
      (d) => d.kind === 'system'
        && !(terms?.non_composable ?? []).includes(d.id)
        && d.summary_keys.length > 0
    ),
    [systemCalcs, terms]
  );

  /** Insert a token at the formula bar's cursor and restore focus there. */
  const insertToken = (token: string) => {
    const el = formulaRef.current;
    const start = el?.selectionStart ?? expression.length;
    const end = el?.selectionEnd ?? expression.length;
    setExpression(expression.slice(0, start) + token + expression.slice(end));
    setPreview(null);
    setPreviewError(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const dirty =
    saved === null
    || name.trim() !== saved.name
    || description.trim() !== (saved.description ?? '')
    || processId !== (saved.process_id ?? DEFAULT_PROCESS)
    || outputGrain !== saved.output_grain
    || expression !== saved.expression;

  const frozen = saved?.status === 'in_review';
  const canSave = !frozen && dirty && name.trim() !== '' && validation?.ok === true;
  const canTest = !frozen && !dirty && saved !== null
    && (saved.status === 'draft' || saved.status === 'tested');
  const canSubmit = !frozen && !dirty && saved?.status === 'tested';

  const runPreview = async () => {
    setBusy('preview');
    setPreview(null);
    setPreviewError(null);
    try {
      const p = await api.previewUserCalc(expression);
      setPreview({ label: 'Preview — nothing persisted', result: p.result, steps: shapeTermSteps(p.trace, catalogByTable) });
    } catch (e) {
      setPreviewError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = async () => {
    setBusy('save');
    try {
      const body = {
        name: name.trim(),
        description: description.trim(),
        process_id: processId,
        output_grain: outputGrain,
        expression,
        actor: user.id,
      };
      const next = saved
        ? await api.patchUserCalc(saved.id, body)
        : await api.createUserCalc(body);
      setSaved(next);
      toast.show(
        `Saved ${next.id} v${next.version} (${next.status}) — recorded at ucalc:${next.id}`,
        'success'
      );
      onSaved();
    } catch (e) {
      toast.show(`Save failed: ${String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const testRun = async () => {
    if (!saved) return;
    setBusy('test');
    setPreviewError(null);
    try {
      const res = await api.testUserCalc(saved.id, { actor: user.id });
      setSaved(res.calc);
      setPreview({
        label: `Test run — ${res.calc.id} marked tested`,
        result: res.result,
        steps: shapeTermSteps(res.trace, catalogByTable),
      });
      toast.show(`Test run passed — ${res.calc.id} is now tested`, 'success');
      onSaved();
    } catch (e) {
      toast.show(`Test run failed: ${String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const submitActivation = async () => {
    if (!saved) return;
    setBusy('submit');
    try {
      const next = await api.submitUserCalcActivation(saved.id, { maker: user.id });
      toast.show(
        `${next.id} queued for review — a DIFFERENT reviewer must approve (maker-checker)`,
        'info'
      );
      onSaved();
      onClose();
    } catch (e) {
      toast.show(`Submit failed: ${String(e)}`, 'error');
      setBusy(null);
    }
  };

  const grainMismatch =
    preview !== null && preview.result.grain !== outputGrain;

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          <span>{saved ? `Edit ${saved.id}` : 'New calculation'}</span>
          <Chip size="small" variant="outlined" label="expression" sx={{ height: 22 }} />
          {saved && (
            <>
              <Chip size="small" variant="outlined" label={`v${saved.version}`} sx={{ height: 22 }} />
              <Chip
                size="small"
                color={saved.status === 'active' ? 'success' : saved.status === 'in_review' ? 'warning' : saved.status === 'tested' ? 'info' : 'default'}
                label={saved.status}
                sx={{ height: 22, fontWeight: 700 }}
              />
            </>
          )}
        </Stack>
        {saved && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {STATUS_HINT[saved.status]}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {/* Identity: name / type (fixed) / process binding / output grain */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              sx={{ flex: 2 }}
              placeholder="e.g. Projected revenue"
              disabled={frozen}
            />
            <TextField
              select
              label="Process binding"
              value={processId}
              onChange={(e) => setProcessId(e.target.value)}
              sx={{ flex: 1.4, minWidth: 170 }}
              disabled={frozen}
            >
              {(processes ?? []).map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.id} — {p.name}
                </MenuItem>
              ))}
              {/* Keep the current value addressable while the catalog loads
                  (or if it ever fails) — the Select never goes out of range. */}
              {(processes === null || !processes.some((p) => p.id === processId)) && (
                <MenuItem value={processId}>{processId}</MenuItem>
              )}
            </TextField>
            <TextField
              select
              label="Output grain"
              value={outputGrain}
              onChange={(e) => setOutputGrain(e.target.value)}
              sx={{ flex: 1, minWidth: 150 }}
              disabled={frozen}
              helperText="Test run enforces it"
            >
              {(terms?.grains ?? ['group', 'entity', 'entity_function']).map((g) => (
                <MenuItem key={g} value={g}>{g}</MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            placeholder="What does this calculation answer?"
            disabled={frozen}
          />

          {/* Term pickers — click to insert a token at the cursor. */}
          <Box>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>
              Terms — click to insert into the formula
            </Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mt: 0.5 }}>
              <PickerPanel title="Governed parameters" hint="param(key) — Drivers & Assumptions store">
                {params === null ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={18} /></Box>
                ) : (
                  <List dense disablePadding>
                    {params.map((p) => (
                      <ListItemButton
                        key={p.key}
                        disabled={frozen}
                        onClick={() => insertToken(`param('${p.key}')`)}
                        sx={{ py: 0.25 }}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700 }} noWrap>
                            {p.key}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }} noWrap>
                            = {valueText(p.value)}
                          </Typography>
                        </Box>
                      </ListItemButton>
                    ))}
                  </List>
                )}
              </PickerPanel>
              <PickerPanel title="Warehouse measures" hint={`measure(ref, grain) — inserted at '${outputGrain}' grain`}>
                {terms === null ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={18} /></Box>
                ) : (
                  <List dense disablePadding>
                    {terms.measures.flatMap((t) =>
                      t.measures.map((col) => (
                        <ListItemButton
                          key={`${t.table}.${col}`}
                          disabled={frozen}
                          onClick={() => insertToken(`measure('${t.table}.${col}', '${outputGrain}')`)}
                          sx={{ py: 0.25 }}
                        >
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700 }} noWrap>
                            {t.table}.{col}
                          </Typography>
                        </ListItemButton>
                      ))
                    )}
                  </List>
                )}
              </PickerPanel>
              <PickerPanel title="Existing calculations" hint="calc(id, output) — composable system calcs">
                {systemCalcs === null ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={18} /></Box>
                ) : (
                  <List dense disablePadding>
                    {composable.map((d) => (
                      <Box key={d.id} sx={{ px: 1.5, py: 0.5 }}>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700 }} noWrap>
                          {d.id}
                        </Typography>
                        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.25 }}>
                          {d.summary_keys.map((k) => (
                            <Chip
                              key={k}
                              size="small"
                              variant="outlined"
                              label={k}
                              disabled={frozen}
                              onClick={() => insertToken(`calc('${d.id}', '${k}')`)}
                              sx={{ height: 20, fontSize: 11, fontFamily: 'monospace' }}
                            />
                          ))}
                        </Stack>
                      </Box>
                    ))}
                  </List>
                )}
              </PickerPanel>
            </Stack>
          </Box>

          {/* Formula bar — monospace, validated live against the engine. */}
          <Box>
            <TextField
              label="Formula"
              value={expression}
              onChange={(e) => {
                setExpression(e.target.value);
                setPreview(null);
                setPreviewError(null);
              }}
              fullWidth
              multiline
              minRows={3}
              maxRows={8}
              disabled={frozen}
              inputRef={formulaRef}
              placeholder="measure('segment_pl.revenue', 'entity', 'GJAHR=2026') * (1 + param('csa.growth'))"
              InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13.5 } }}
            />
            {expression.trim() === '' ? (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Insert terms from the pickers or type directly — ops + − × ÷ ( ), funcs
                sum/min/max/abs/if(cond, a, b); measure filters like 'GJAHR=2026,RBUKRS=1000'.
              </Typography>
            ) : validation === null ? (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>Validating…</Typography>
            ) : validation.ok ? (
              <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 700 }}>
                ✓ Valid — {validation.terms.length} term{validation.terms.length === 1 ? '' : 's'} resolved
              </Typography>
            ) : (
              <Alert severity="error" variant="outlined" sx={{ mt: 1 }}>
                <Stack spacing={0.25}>
                  {validation.errors.map((err, i) => (
                    <Typography key={i} variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12.5 }}>
                      {err.pos != null ? `char ${err.pos}: ` : ''}{err.message}
                    </Typography>
                  ))}
                </Stack>
              </Alert>
            )}
          </Box>

          <Divider />

          {/* Preview — evaluate now, persist nothing (PaPM "Show"). */}
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                variant="outlined"
                startIcon={busy === 'preview' ? <CircularProgress size={16} /> : <PreviewOutlinedIcon />}
                onClick={() => void runPreview()}
                disabled={validation?.ok !== true || busy !== null}
              >
                {busy === 'preview' ? 'Evaluating…' : 'Preview'}
              </Button>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Evaluates against the live warehouse + governed store — nothing persists, nothing is audited.
              </Typography>
            </Stack>
            {previewError && (
              <Alert severity="error" variant="outlined" onClose={() => setPreviewError(null)}>
                {previewError}
              </Alert>
            )}
            {preview && (
              <Stack spacing={1}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{preview.label}</Typography>
                {grainMismatch && (
                  <Alert severity="warning" variant="outlined">
                    The expression evaluates at <b>{preview.result.grain}</b> grain but the calculation
                    declares <b>{outputGrain}</b> — the test run will reject it.
                  </Alert>
                )}
                <ResultView result={preview.result} />
                {preview.steps.length > 0 && (
                  <Box>
                    <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                      Term values
                    </Typography>
                    <TraceTree steps={preview.steps} />
                  </Box>
                )}
              </Stack>
            )}
          </Stack>

          <Alert severity="info" variant="outlined">
            Maker-checker: <b>Save draft</b> → <b>Test run</b> (gates activation on the current
            formula) → <b>Submit for activation</b> queues a review item at{' '}
            <b>ucalc:{saved?.id ?? '{id}'}</b> — only an approval by a <b>different</b> reviewer
            makes it Active in the registry. Every step is hash-chained.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy !== null}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => void saveDraft()}
          disabled={!canSave || busy !== null}
          startIcon={busy === 'save' ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {busy === 'save' ? 'Saving…' : 'Save draft'}
        </Button>
        <Button
          variant="outlined"
          onClick={() => void testRun()}
          disabled={!canTest || busy !== null}
          startIcon={busy === 'test' ? <CircularProgress size={16} /> : <PlayArrowIcon />}
        >
          {busy === 'test' ? 'Testing…' : 'Test run'}
        </Button>
        <Button
          variant="outlined"
          color="success"
          onClick={() => void submitActivation()}
          disabled={!canSubmit || busy !== null}
          startIcon={busy === 'submit' ? <CircularProgress size={16} /> : undefined}
        >
          {busy === 'submit' ? 'Submitting…' : 'Submit for activation'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
