import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, MenuItem, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { api } from '@/shared/api/client';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useToast } from '@/shared/providers/DataProvider';
import { useRefreshSignals } from '@/shared/providers/WorkSignalsProvider';
import { useReviewHandoff } from '@/kernel/review/ReviewHandoff';
import type {
  CalcDef, Parameter, Scenario, ScenarioCompare, ScenarioStatus,
} from '@/shared/api/types';
import CompareTable from '../components/CompareTable';
import { valueText, useParameters } from '../lib';

/** Scenarios — what-if bundles of parameter overrides over the governed store
 *  (CS-c). A run under a scenario overlays its values via the backend
 *  contextvar; the store itself is NEVER written until a DIFFERENT reviewer
 *  approves the promotion in the /review queue. Every mutation hash-chains at
 *  record_ref="scenario:{id}". */

const STATUS_CHIP: Record<ScenarioStatus, { label: string; color: 'default' | 'warning' | 'success' }> = {
  draft: { label: 'draft', color: 'default' },
  in_review: { label: 'in review', color: 'warning' },
  promoted: { label: 'promoted', color: 'success' },
  discarded: { label: 'discarded', color: 'default' },
};

/** Parse an edited override back to the parameter's JSON shape — the same
 *  type-driven logic as DriversTab's EditDialog. */
function parseRaw(type: string | null, raw: string): { ok: boolean; value: unknown; err?: string } {
  const t = raw.trim();
  try {
    if (type === 'number') {
      if (t === '' || Number.isNaN(Number(t))) return { ok: false, value: null, err: 'Enter a number' };
      return { ok: true, value: Number(t) };
    }
    if (type === 'string') return { ok: true, value: t };
    // list / dict / unknown → parse as JSON
    return { ok: true, value: JSON.parse(t) };
  } catch (e) {
    return { ok: false, value: null, err: `Invalid JSON: ${String(e)}` };
  }
}

interface OverrideRow {
  key: string;
  raw: string;
}

/** Create / edit dialog: name + description + an override editor over the
 *  governed parameters (add/remove keys, type-aware value parsing). Editing
 *  PATCHes only while the scenario is a draft (the backend enforces it too). */
function ScenarioDialog({
  scenario, params, onClose, onSaved,
}: {
  scenario: Scenario | null; // null = create
  params: Parameter[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const user = useSessionUser();
  const toast = useToast();
  const [name, setName] = useState(scenario?.name ?? '');
  const [description, setDescription] = useState(scenario?.description ?? '');
  const [rows, setRows] = useState<OverrideRow[]>(
    Object.entries(scenario?.overrides ?? {}).map(([key, v]) => ({ key, raw: valueText(v) }))
  );
  const [addKey, setAddKey] = useState('');
  const [saving, setSaving] = useState(false);

  const byKey = useMemo(() => new Map(params.map((p) => [p.key, p])), [params]);
  const available = params.filter((p) => !rows.some((r) => r.key === p.key));

  const parsed = rows.map((r) => parseRaw(byKey.get(r.key)?.type ?? null, r.raw));
  const allOk = parsed.every((p) => p.ok);
  const canSave = name.trim() !== '' && rows.length > 0 && allOk;

  const addOverride = () => {
    const p = byKey.get(addKey);
    if (!p) return;
    setRows((prev) => [...prev, { key: p.key, raw: valueText(p.value) }]);
    setAddKey('');
  };

  const save = async () => {
    setSaving(true);
    const overrides = Object.fromEntries(rows.map((r, i) => [r.key, parsed[i].value]));
    try {
      const saved = scenario
        ? await api.patchScenario(scenario.id, {
            name: name.trim(), description: description.trim() || undefined, overrides, actor: user.id,
          })
        : await api.createScenario({
            name: name.trim(), description: description.trim() || undefined, overrides, actor: user.id,
          });
      toast.show(`Saved ${saved.id} — recorded at scenario:${saved.id}`, 'success');
      onSaved();
      onClose();
    } catch (e) {
      toast.show(`Save failed: ${String(e)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{scenario ? `Edit ${scenario.id}` : 'New scenario'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            placeholder="e.g. RAB growth 10%"
          />
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            placeholder="What question does this scenario answer?"
          />

          <Box>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>
              Parameter overrides
            </Typography>
            {rows.length === 0 && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                No overrides yet — add a governed parameter below.
              </Typography>
            )}
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              {rows.map((r, i) => {
                const p = byKey.get(r.key);
                const isStructured = p?.type === 'list' || p?.type === 'dict';
                return (
                  <Stack key={r.key} direction="row" spacing={1} alignItems="flex-start">
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                        {r.key}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        governed value: {valueText(p?.value)}
                      </Typography>
                    </Box>
                    <TextField
                      size="small"
                      value={r.raw}
                      onChange={(e) =>
                        setRows((prev) => prev.map((x, j) => (j === i ? { ...x, raw: e.target.value } : x)))
                      }
                      error={!parsed[i].ok}
                      helperText={!parsed[i].ok ? parsed[i].err : undefined}
                      multiline={isStructured}
                      minRows={isStructured ? 2 : undefined}
                      sx={{ flex: 1, '& input, & textarea': { fontFamily: 'monospace', fontSize: 13 } }}
                    />
                    <IconButton
                      size="small"
                      aria-label={`Remove ${r.key}`}
                      onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                );
              })}
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <TextField
                select
                size="small"
                label="Add parameter"
                value={addKey}
                onChange={(e) => setAddKey(e.target.value)}
                sx={{ flex: 1 }}
              >
                {available.map((p) => (
                  <MenuItem key={p.key} value={p.key}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{p.key}</Typography>
                  </MenuItem>
                ))}
              </TextField>
              <Button startIcon={<AddIcon />} onClick={addOverride} disabled={!addKey}>
                Add
              </Button>
            </Stack>
          </Box>

          <Alert severity="info" variant="outlined">
            A scenario run overlays these values for that run only — the governed store is written
            exclusively through promotion, where a <b>different</b> reviewer approves each change.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={!canSave || saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Compare dialog: pick a scenario-capable calculation, run base + scenario
 *  via POST /api/scenarios/{id}/compare, render Base | Scenario | Δ. */
function CompareDialog({ scenario, onClose }: { scenario: Scenario; onClose: () => void }) {
  const user = useSessionUser();
  const [calcs, setCalcs] = useState<CalcDef[] | null>(null);
  const [calcId, setCalcId] = useState('');
  const [comparing, setComparing] = useState(false);
  const [result, setResult] = useState<ScenarioCompare | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.calcs()
      .then((ds) => {
        const capable = ds.filter((d) => d.scenario_capable);
        setCalcs(capable);
        if (capable.length > 0) setCalcId(capable[0].id);
      })
      .catch(() => setCalcs([]));
  }, []);

  const compare = async () => {
    setComparing(true);
    setResult(null);
    setError(null);
    try {
      setResult(await api.compareScenario(scenario.id, { calc_id: calcId, actor: user.id }));
    } catch (e) {
      setError(String(e));
    } finally {
      setComparing(false);
    }
  };

  const selected = calcs?.find((d) => d.id === calcId) ?? null;

  return (
    <Dialog open onClose={comparing ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Compare — {scenario.name}{' '}
        <Typography component="span" variant="body2" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
          ({scenario.id})
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {calcs === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        ) : (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1}>
              <TextField
                select
                size="small"
                label="Calculation"
                value={calcId}
                onChange={(e) => setCalcId(e.target.value)}
                sx={{ flex: 1 }}
              >
                {calcs.map((d) => (
                  <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
                ))}
              </TextField>
              <Button
                variant="contained"
                onClick={() => void compare()}
                disabled={!calcId || comparing}
                startIcon={comparing ? <CircularProgress size={16} color="inherit" /> : undefined}
              >
                {comparing ? 'Comparing…' : 'Compare'}
              </Button>
            </Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Runs the calculation twice — once against the governed store, once under this
              scenario's overrides — and diffs every matching numeric path. Both runs land in the
              run console; nothing is written to the store.
            </Typography>
            {error && (
              <Alert severity="error" variant="outlined" onClose={() => setError(null)}>
                Compare failed: {error}
              </Alert>
            )}
            {result && selected && <CompareTable calc={selected} result={result} />}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={comparing}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function ScenariosTab() {
  const { params } = useParameters();
  const user = useSessionUser();
  const toast = useToast();
  const refreshSignals = useRefreshSignals();
  const { notifySubmitted } = useReviewHandoff();
  const [list, setList] = useState<Scenario[] | null>(null);
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; scenario: Scenario } | null>(null);
  const [comparing, setComparing] = useState<Scenario | null>(null);

  const refresh = () => api.scenarios().then(setList).catch(() => setList([]));
  useEffect(() => { void refresh(); }, []);

  // ?scenario={id} focus deep-link (the "Fix & resubmit" landing for a
  // rejected scenario:{id} review item): highlight the row and, while it is
  // still editable (draft), auto-open the edit dialog. Keyed on the id (the
  // CockpitPage ?calc= idiom) so it fires once per target — and re-fires if the
  // deep-link target changes in place — without a bare once-flag.
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('scenario');
  const focusLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || focusLoadedRef.current === focusId || list === null) return;
    const target = list.find((s) => s.id === focusId);
    if (!target) return;
    focusLoadedRef.current = focusId;
    if (target.status === 'draft') setDialog({ mode: 'edit', scenario: target });
  }, [focusId, list]);

  if (list === null || params === null) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  }

  const promote = async (s: Scenario) => {
    try {
      await api.promoteScenario(s.id, { maker: user.id });
      notifySubmitted({ recordRef: `scenario:${s.id}`, label: s.name });
      void refresh();
      void refreshSignals(); // bell badge / home Command Center / My work
    } catch (e) {
      toast.show(`Promote failed: ${String(e)}`, 'error');
    }
  };

  const discard = async (s: Scenario) => {
    try {
      await api.discardScenario(s.id, { actor: user.id });
      toast.show(`Discarded ${s.id}`, 'success');
      void refresh();
      void refreshSignals(); // withdraws any pending review item for it
    } catch (e) {
      toast.show(`Discard failed: ${String(e)}`, 'error');
    }
  };

  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        What-if scenarios — named bundles of driver overrides overlaid over the governed store for a
        run, never written to it. Compare shows <b>Base | Scenario | Δ</b> side by side; Promote
        queues the overrides for maker-checker review, and only an approval by a{' '}
        <b>different</b> reviewer applies them (each individually audited at{' '}
        <b>param:&#123;key&#125;</b>).
      </Alert>

      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ mode: 'create' })}>
          New scenario
        </Button>
      </Stack>

      {list.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>No scenarios yet</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            Create one to test a driver change — e.g. RAB growth at 10% — before promoting it.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Scenario</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Overrides</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {list.map((s) => {
                const chip = STATUS_CHIP[s.status];
                const keys = Object.keys(s.overrides);
                return (
                  <TableRow
                    key={s.id}
                    hover
                    // Focus-border for the ?scenario= deep-link (the same violet
                    // highlight InboundMapping uses for ?focus=).
                    sx={s.id === focusId ? { boxShadow: 'inset 0 0 0 2px #7C3AED' } : undefined}
                  >
                    <TableCell sx={{ maxWidth: 300 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{s.name}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                        {s.id}{s.description ? ` — ${s.description}` : ''}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={chip.color}
                        variant={s.status === 'discarded' ? 'outlined' : 'filled'}
                        label={chip.label}
                        sx={{ height: 20, fontSize: 11 }}
                      />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 260 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {keys.length} parameter{keys.length === 1 ? '' : 's'}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
                        {keys.join(', ')}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Typography variant="body2">{s.created_by}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {new Date(s.created_at).toLocaleString()}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        {s.status === 'draft' && (
                          <Button size="small" variant="outlined" onClick={() => setDialog({ mode: 'edit', scenario: s })}>
                            Edit
                          </Button>
                        )}
                        <Button size="small" onClick={() => setComparing(s)}>Compare</Button>
                        {s.status === 'draft' && (
                          <>
                            <Button size="small" color="primary" onClick={() => void promote(s)}>Promote</Button>
                            <Button size="small" color="error" onClick={() => void discard(s)}>Discard</Button>
                          </>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {dialog && (
        <ScenarioDialog
          scenario={dialog.mode === 'edit' ? dialog.scenario : null}
          params={params}
          onClose={() => setDialog(null)}
          onSaved={() => void refresh()}
        />
      )}
      {comparing && <CompareDialog scenario={comparing} onClose={() => setComparing(null)} />}
    </Stack>
  );
}
