import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, ButtonGroup, Chip, CircularProgress, ClickAwayListener,
  Divider, Grow, MenuItem, MenuList, Paper, Popper, Stack, TextField, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { api } from '@/shared/api/client';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useToast } from '@/shared/providers/DataProvider';
import type {
  AuthoredDataset, AuthoredDatasetStatus, AuthoredPool, AuthoredPoolStatus,
  Scenario, UserCalc,
} from '@/shared/api/types';
import { useGraphModel } from './useGraphModel';
import Canvas from './Canvas';
import NodePalette from './NodePalette';
import NodeInspector from './NodeInspector';
import ResultsDock from './ResultsDock';

/** The cockpit (Phase 7 MC2) — the unifying home surface for the calc loop, a
 *  3-pane command center (left palette / center React Flow canvas / right inline
 *  inspector) over a bottom Results dock. ONE always-visible Run/Preview paints
 *  values onto nodes + the dock; ONE split-button drives Save → Test → Submit
 *  through the EXISTING user-calc lifecycle (a graph compiles to a calc/expr.py
 *  expression server-side — no new evaluator); a Base⟷Scenario toggle re-runs
 *  the graph under a governed scenario's overlay and paints Δ. No modal dialogs
 *  in the build loop. Open an existing formula calc (?calc=ID) and its graph
 *  round-trips onto the canvas.
 */

const DEFAULT_PROCESS = 'OTP-49';
const GRAINS = ['group', 'entity', 'entity_function'];

const STATUS_COLOR: Record<UserCalc['status'], 'default' | 'info' | 'warning' | 'success'> = {
  draft: 'default', tested: 'info', in_review: 'warning', active: 'success',
};

const POOL_STATUS_COLOR: Record<AuthoredPoolStatus, 'default' | 'info' | 'warning' | 'success'> = {
  draft: 'default', tested: 'info', in_review: 'warning', active: 'success',
};

const DATASET_STATUS_COLOR: Record<AuthoredDatasetStatus, 'default' | 'info' | 'warning' | 'success'> = {
  draft: 'default', tested: 'info', in_review: 'warning', active: 'success',
};

export default function CockpitPage() {
  const user = useSessionUser();
  const toast = useToast();
  const model = useGraphModel();
  const [searchParams, setSearchParams] = useSearchParams();

  // The user-calc this canvas is bound to (null = unsaved new calc).
  const [saved, setSaved] = useState<UserCalc | null>(null);
  // The authored pool this canvas is bound to when it's an ALLOCATION stage graph
  // (MC3 — the alloc-family analogue of `saved`).
  const [savedPool, setSavedPool] = useState<AuthoredPool | null>(null);
  // The authored dataset this canvas is bound to when it's a DATASET graph (DS3).
  const [savedDataset, setSavedDataset] = useState<AuthoredDataset | null>(null);
  const [name, setName] = useState('');
  const [processId, setProcessId] = useState(DEFAULT_PROCESS);
  const [outputGrain, setOutputGrain] = useState('group');
  const [busy, setBusy] = useState<'save' | 'test' | 'submit' | null>(null);

  const isAlloc = model.family === 'alloc';
  const isDataset = model.family === 'dataset';

  // Split-button menu anchor.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLDivElement | null>(null);

  // Scenario overlay (Base⟷Scenario toggle).
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [mode, setMode] = useState<'base' | 'scenario'>('base');
  const [scenarioId, setScenarioId] = useState<string>('');

  // Open-existing-calc menu.
  const [openMenu, setOpenMenu] = useState(false);
  const openAnchor = useRef<HTMLButtonElement | null>(null);
  const [calcs, setCalcs] = useState<UserCalc[]>([]);

  useEffect(() => {
    api.scenarios('draft').then(setScenarios).catch(() => setScenarios([]));
    api.userCalcs().then(setCalcs).catch(() => setCalcs([]));
  }, []);

  // Load an existing calc's graph for round-trip (?calc=ID), once the param is
  // present. The graph comes from the backend (stored graph_json or
  // expr_to_graph(expression) — the formula bar and canvas are two views).
  const loadCalcId = searchParams.get('calc');
  const loadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!loadCalcId || loadedRef.current === loadCalcId) return;
    loadedRef.current = loadCalcId;
    void (async () => {
      try {
        const [calc, graph] = await Promise.all([
          api.userCalc(loadCalcId),
          api.userCalcGraph(loadCalcId),
        ]);
        setSaved(calc);
        setName(calc.name);
        setProcessId(calc.process_id ?? DEFAULT_PROCESS);
        setOutputGrain(calc.output_grain);
        model.loadGraph(graph);
        toast.show(`Loaded ${calc.id} onto the canvas`, 'info');
      } catch (e) {
        toast.show(`Could not load calc: ${String(e)}`, 'error');
      }
    })();
    // model.loadGraph is stable enough; intentionally not in deps to avoid reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadCalcId]);

  const overridesFor = (sid: string): Record<string, unknown> =>
    (scenarios.find((s) => s.id === sid)?.overrides as Record<string, unknown>) ?? {};

  const activeOverrides = mode === 'scenario' && scenarioId ? overridesFor(scenarioId) : undefined;

  const run = () => void model.runPreview(activeOverrides);

  // Re-run when toggling scenario/base or switching scenario (so the canvas
  // repaints under the chosen overlay without a second click).
  useEffect(() => {
    if (model.nodes.length === 0) return;
    if (mode === 'scenario' && !scenarioId) return;
    void model.runPreview(activeOverrides);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, scenarioId]);

  const graphValid = model.validation?.ok === true && model.nodes.length > 0;

  // ---- lifecycle (Save / Test / Submit) via the existing user-calc path ----
  const saveDraft = async () => {
    if (!graphValid) {
      toast.show('Fix the graph before saving — see Exceptions.', 'error');
      return;
    }
    if (name.trim() === '') {
      toast.show('Name the calculation before saving.', 'error');
      return;
    }
    setBusy('save');
    try {
      const graph = model.toGraph();
      const body = {
        name: name.trim(),
        graph,
        process_id: processId,
        output_grain: outputGrain,
        actor: user.id,
      };
      const next = saved
        ? await api.patchUserCalcGraph(saved.id, body)
        : await api.createUserCalcGraph(body);
      setSaved(next);
      // Refresh the open-existing list so the new calc is reachable.
      api.userCalcs().then(setCalcs).catch(() => undefined);
      toast.show(`Saved ${next.id} v${next.version} (${next.status}) — recorded at ucalc:${next.id}`, 'success');
    } catch (e) {
      toast.show(`Save failed: ${String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const testRun = async () => {
    if (!saved) { toast.show('Save the draft before testing.', 'info'); return; }
    setBusy('test');
    try {
      const res = await api.testUserCalc(saved.id, { actor: user.id });
      setSaved(res.calc);
      toast.show(`Test run passed — ${res.calc.id} is now tested`, 'success');
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
      setSaved(next);
      toast.show(`${next.id} queued for review — a DIFFERENT reviewer must approve (maker-checker)`, 'info');
    } catch (e) {
      toast.show(`Submit failed: ${String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  // ---- allocation stage-graph lifecycle (MC3) via the authored-pool path ----
  // The stage graph compiles to an authored-pool definition server-side, so
  // Save/Test/Submit reuse the EXISTING PB2 lifecycle (draft → tested → review →
  // active, maker-checker at allocpool:{id}) — no new engine. The pool's name is
  // the canvas name field; the graph is persisted alongside the definition.
  const savePool = async () => {
    if (!graphValid) { toast.show('Fix the stage graph before saving — see Exceptions.', 'error'); return; }
    setBusy('save');
    try {
      const graph = model.toGraph();
      const next = savedPool
        ? await api.updateAuthoredPoolGraph(savedPool.id, user.id, graph)
        : await api.createAuthoredPoolGraph(graph, user.id, processId);
      setSavedPool(next);
      toast.show(`Saved ${next.id} v${next.version} (${next.status}) — recorded at allocpool:${next.id}`, 'success');
    } catch (e) {
      toast.show(`Save failed: ${String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const testPool = async () => {
    if (!savedPool) { toast.show('Save the draft pool before testing.', 'info'); return; }
    setBusy('test');
    try {
      const res = await api.testAuthoredPool(savedPool.id, user.id);
      setSavedPool(res.pool);
      if (res.tested) {
        toast.show(`Dry-run Balanced — ${res.pool.id} is now tested`, 'success');
      } else {
        const blocks = res.dry_run.exceptions.filter((x) => x.severity === 'BLOCK').length;
        toast.show(`Dry-run not sound (${blocks} BLOCK) — pool stays a draft`, 'warning');
      }
    } catch (e) {
      toast.show(`Test run failed: ${String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const submitPool = async () => {
    if (!savedPool) return;
    setBusy('submit');
    try {
      const next = await api.submitAuthoredPoolActivation(savedPool.id, user.id);
      setSavedPool(next);
      toast.show(`${next.id} queued for review — a DIFFERENT reviewer must approve (maker-checker)`, 'info');
    } catch (e) {
      toast.show(`Submit failed: ${String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  // ---- dataset-graph lifecycle (DS3) via the authored-dataset path ----
  // A dataset graph compiles to ONE safe parameterized DuckDB query server-side,
  // so Save/Test/Submit reuse the EXISTING DS2 lifecycle (draft → tested →
  // review → active, maker-checker at dataset:{id}) — no new engine. The graph is
  // the source of truth.
  const saveDataset = async () => {
    if (!graphValid) { toast.show('Fix the dataset before saving — see Exceptions.', 'error'); return; }
    if (name.trim() === '') { toast.show('Name the dataset before saving.', 'error'); return; }
    setBusy('save');
    try {
      const graph = model.toGraph();
      const next = savedDataset
        ? await api.updateAuthoredDataset(savedDataset.id, { definition: graph, actor: user.id })
        : await api.createAuthoredDataset({ name: name.trim(), definition: graph, process_id: processId, actor: user.id });
      setSavedDataset(next);
      toast.show(`Saved ${next.id} v${next.version} (${next.status}) — recorded at dataset:${next.id}`, 'success');
    } catch (e) {
      toast.show(`Save failed: ${String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const testDataset = async () => {
    if (!savedDataset) { toast.show('Save the draft dataset before testing.', 'info'); return; }
    setBusy('test');
    try {
      const res = await api.testAuthoredDataset(savedDataset.id, user.id);
      setSavedDataset(res.dataset);
      toast.show(`Compile + run passed (${res.result.row_count} rows) — ${res.dataset.id} is now tested`, 'success');
    } catch (e) {
      toast.show(`Test run failed: ${String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const submitDataset = async () => {
    if (!savedDataset) return;
    setBusy('submit');
    try {
      const next = await api.submitAuthoredDatasetActivation(savedDataset.id, user.id);
      setSavedDataset(next);
      toast.show(`${next.id} queued for review — a DIFFERENT reviewer must approve (maker-checker)`, 'info');
    } catch (e) {
      toast.show(`Submit failed: ${String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  // The split-button's primary action follows the lifecycle state, branching on
  // the canvas family (calc → user-calc path; alloc → authored-pool path;
  // dataset → authored-dataset path).
  const primary = useMemo(() => {
    if (isDataset) {
      if (!savedDataset) return { key: 'save' as const, label: 'Save draft dataset', fn: saveDataset, enabled: graphValid && name.trim() !== '' };
      if (savedDataset.status === 'draft') return { key: 'test' as const, label: 'Test run (compile + run)', fn: testDataset, enabled: true };
      if (savedDataset.status === 'tested') return { key: 'submit' as const, label: 'Submit for activation', fn: submitDataset, enabled: true };
      if (savedDataset.status === 'in_review') return { key: 'save' as const, label: 'In review', fn: async () => undefined, enabled: false };
      return { key: 'save' as const, label: 'Save new version', fn: saveDataset, enabled: graphValid };
    }
    if (isAlloc) {
      if (!savedPool) return { key: 'save' as const, label: 'Save draft pool', fn: savePool, enabled: graphValid && name.trim() !== '' };
      if (savedPool.status === 'draft' || savedPool.status === 'tested') {
        if (savedPool.status === 'tested') return { key: 'submit' as const, label: 'Submit for activation', fn: submitPool, enabled: true };
        return { key: 'test' as const, label: 'Test run', fn: testPool, enabled: true };
      }
      if (savedPool.status === 'in_review') return { key: 'save' as const, label: 'In review', fn: async () => undefined, enabled: false };
      return { key: 'save' as const, label: 'Save new version', fn: savePool, enabled: graphValid };
    }
    if (!saved) return { key: 'save' as const, label: 'Save draft', fn: saveDraft, enabled: graphValid && name.trim() !== '' };
    if (saved.status === 'draft') return { key: 'test' as const, label: 'Test run', fn: testRun, enabled: true };
    if (saved.status === 'tested') return { key: 'submit' as const, label: 'Submit for activation', fn: submitActivation, enabled: true };
    if (saved.status === 'in_review') return { key: 'save' as const, label: 'In review', fn: async () => undefined, enabled: false };
    return { key: 'save' as const, label: 'Save new version', fn: saveDraft, enabled: graphValid };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAlloc, isDataset, saved, savedPool, savedDataset, graphValid, name, model]);

  const newCalc = () => {
    setSaved(null);
    setSavedPool(null);
    setSavedDataset(null);
    setName('');
    setOutputGrain('group');
    setProcessId(DEFAULT_PROCESS);
    model.clearGraph();
    loadedRef.current = null;
    if (searchParams.get('calc')) {
      searchParams.delete('calc');
      setSearchParams(searchParams, { replace: true });
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', minHeight: 520 }}>
      {/* ---- top action bar ---- */}
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', flexWrap: 'wrap', rowGap: 1 }}
      >
        <TextField
          size="small"
          placeholder={isAlloc ? 'Pool name' : isDataset ? 'Dataset name' : 'Calculation name'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ width: 220 }}
        />
        {!isAlloc && !isDataset && (
          <TextField
            select size="small" label="Output grain" value={outputGrain}
            onChange={(e) => setOutputGrain(e.target.value)} sx={{ width: 150 }}
          >
            {GRAINS.map((g) => <MenuItem key={g} value={g}>{g}</MenuItem>)}
          </TextField>
        )}
        {isAlloc && (
          <Chip size="small" color="primary" variant="outlined" label="allocation pool"
            sx={{ height: 22, fontWeight: 700 }} />
        )}
        {isDataset && (
          <Chip size="small" color="secondary" variant="outlined" label="dataset"
            sx={{ height: 22, fontWeight: 700 }} />
        )}
        {isDataset && savedDataset && (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Chip size="small" variant="outlined" label={savedDataset.id} sx={{ height: 22, fontFamily: 'monospace' }} />
            <Chip size="small" variant="outlined" label={`v${savedDataset.version}`} sx={{ height: 22 }} />
            <Chip size="small" color={DATASET_STATUS_COLOR[savedDataset.status]} label={savedDataset.status} sx={{ height: 22, fontWeight: 700 }} />
          </Stack>
        )}
        {!isAlloc && saved && (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Chip size="small" variant="outlined" label={saved.id} sx={{ height: 22, fontFamily: 'monospace' }} />
            <Chip size="small" variant="outlined" label={`v${saved.version}`} sx={{ height: 22 }} />
            <Chip size="small" color={STATUS_COLOR[saved.status]} label={saved.status} sx={{ height: 22, fontWeight: 700 }} />
          </Stack>
        )}
        {isAlloc && savedPool && (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Chip size="small" variant="outlined" label={savedPool.id} sx={{ height: 22, fontFamily: 'monospace' }} />
            <Chip size="small" variant="outlined" label={`v${savedPool.version}`} sx={{ height: 22 }} />
            <Chip size="small" color={POOL_STATUS_COLOR[savedPool.status]} label={savedPool.status} sx={{ height: 22, fontWeight: 700 }} />
          </Stack>
        )}

        <Box sx={{ flex: 1 }} />

        {/* Base ⟷ Scenario toggle — calc graphs only (a stage graph runs through
            the allocation engine, a dataset through DuckDB — neither uses the
            scenario-overlay evaluator). */}
        {!isAlloc && !isDataset && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={mode}
            onChange={(_, v) => v && setMode(v)}
          >
            <ToggleButton value="base" sx={{ px: 1.5 }}>Base</ToggleButton>
            <ToggleButton value="scenario" sx={{ px: 1.5 }} disabled={scenarios.length === 0}>Scenario</ToggleButton>
          </ToggleButtonGroup>
        )}
        {!isAlloc && !isDataset && mode === 'scenario' && (
          <TextField
            select size="small" label="Scenario" value={scenarioId}
            onChange={(e) => setScenarioId(e.target.value)} sx={{ width: 200 }}
          >
            {scenarios.length === 0 && <MenuItem value="">No draft scenarios</MenuItem>}
            {scenarios.map((s) => (
              <MenuItem key={s.id} value={s.id}>{s.id} — {s.name}</MenuItem>
            ))}
          </TextField>
        )}

        {/* Run / Preview — ONE always-visible action */}
        <Button
          variant="contained"
          startIcon={model.running ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
          onClick={run}
          disabled={!graphValid || model.running}
        >
          {model.running ? 'Running…' : 'Run / Preview'}
        </Button>

        {/* Save / Test / Submit — ONE split-button */}
        <ButtonGroup variant="outlined" ref={menuAnchor} disabled={busy !== null}>
          <Button
            onClick={() => void primary.fn()}
            disabled={!primary.enabled || busy !== null}
            startIcon={busy ? <CircularProgress size={16} /> : undefined}
          >
            {busy === 'save' ? 'Saving…' : busy === 'test' ? 'Testing…' : busy === 'submit' ? 'Submitting…' : primary.label}
          </Button>
          <Button size="small" onClick={() => setMenuOpen((o) => !o)} sx={{ px: 0.5 }}>
            <ArrowDropDownIcon />
          </Button>
        </ButtonGroup>
        <Popper open={menuOpen} anchorEl={menuAnchor.current} transition placement="bottom-end" sx={{ zIndex: 1300 }}>
          {({ TransitionProps }) => (
            <Grow {...TransitionProps}>
              <Paper elevation={3}>
                <ClickAwayListener onClickAway={() => setMenuOpen(false)}>
                  {isDataset ? (
                  <MenuList dense>
                    <MenuItem
                      disabled={!graphValid || name.trim() === '' || savedDataset?.status === 'in_review'}
                      onClick={() => { setMenuOpen(false); void saveDataset(); }}
                    >
                      Save {savedDataset ? 'new version' : 'draft dataset'}
                    </MenuItem>
                    <MenuItem
                      disabled={!savedDataset || !(savedDataset.status === 'draft' || savedDataset.status === 'tested')}
                      onClick={() => { setMenuOpen(false); void testDataset(); }}
                    >
                      Test run (compile + run)
                    </MenuItem>
                    <MenuItem
                      disabled={!savedDataset || savedDataset.status !== 'tested'}
                      onClick={() => { setMenuOpen(false); void submitDataset(); }}
                    >
                      Submit for activation
                    </MenuItem>
                  </MenuList>
                  ) : isAlloc ? (
                  <MenuList dense>
                    <MenuItem
                      disabled={!graphValid || name.trim() === '' || savedPool?.status === 'in_review'}
                      onClick={() => { setMenuOpen(false); void savePool(); }}
                    >
                      Save {savedPool ? 'new version' : 'draft pool'}
                    </MenuItem>
                    <MenuItem
                      disabled={!savedPool || !(savedPool.status === 'draft' || savedPool.status === 'tested')}
                      onClick={() => { setMenuOpen(false); void testPool(); }}
                    >
                      Test run (dry-run Stages 1-7)
                    </MenuItem>
                    <MenuItem
                      disabled={!savedPool || savedPool.status !== 'tested'}
                      onClick={() => { setMenuOpen(false); void submitPool(); }}
                    >
                      Submit for activation
                    </MenuItem>
                  </MenuList>
                  ) : (
                  <MenuList dense>
                    <MenuItem
                      disabled={!graphValid || name.trim() === '' || saved?.status === 'in_review'}
                      onClick={() => { setMenuOpen(false); void saveDraft(); }}
                    >
                      Save {saved ? 'new version' : 'draft'}
                    </MenuItem>
                    <MenuItem
                      disabled={!saved || !(saved.status === 'draft' || saved.status === 'tested')}
                      onClick={() => { setMenuOpen(false); void testRun(); }}
                    >
                      Test run
                    </MenuItem>
                    <MenuItem
                      disabled={!saved || saved.status !== 'tested'}
                      onClick={() => { setMenuOpen(false); void submitActivation(); }}
                    >
                      Submit for activation
                    </MenuItem>
                  </MenuList>
                  )}
                </ClickAwayListener>
              </Paper>
            </Grow>
          )}
        </Popper>

        {/* Open existing / New */}
        <Tooltip title="Open an existing calculation onto the canvas (graph round-trip)">
          <Button ref={openAnchor} size="small" startIcon={<FolderOpenIcon />} onClick={() => setOpenMenu((o) => !o)}>
            Open
          </Button>
        </Tooltip>
        <Popper open={openMenu} anchorEl={openAnchor.current} transition placement="bottom-end" sx={{ zIndex: 1300 }}>
          {({ TransitionProps }) => (
            <Grow {...TransitionProps}>
              <Paper elevation={3} sx={{ maxHeight: 360, overflow: 'auto', minWidth: 240 }}>
                <ClickAwayListener onClickAway={() => setOpenMenu(false)}>
                  <MenuList dense>
                    {calcs.length === 0 && <MenuItem disabled>No user calculations yet</MenuItem>}
                    {calcs.map((c) => (
                      <MenuItem
                        key={c.id}
                        onClick={() => {
                          setOpenMenu(false);
                          loadedRef.current = null;
                          searchParams.set('calc', c.id);
                          setSearchParams(searchParams, { replace: true });
                        }}
                      >
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip size="small" color={STATUS_COLOR[c.status]} label={c.status} sx={{ height: 18, fontSize: 10 }} />
                          <span>{c.id} — {c.name}</span>
                        </Stack>
                      </MenuItem>
                    ))}
                  </MenuList>
                </ClickAwayListener>
              </Paper>
            </Grow>
          )}
        </Popper>
        <Tooltip title="Start a fresh calculation">
          <Button size="small" startIcon={<RestartAltIcon />} onClick={newCalc}>New</Button>
        </Tooltip>
      </Stack>

      {!isAlloc && saved?.status === 'active' && (
        <Alert severity="success" variant="outlined" sx={{ mx: 1.5, mt: 1, py: 0 }}>
          {saved.id} is active. Editing the canvas and saving creates a new draft version (re-test + re-approval).
        </Alert>
      )}
      {isAlloc && savedPool?.status === 'active' && (
        <Alert severity="success" variant="outlined" sx={{ mx: 1.5, mt: 1, py: 0 }}>
          {savedPool.id} is active (a governed experiment, flagged authored). It runs via the authored
          allocation run — the governed seeded allocation stays cent-exact and is never touched.
        </Alert>
      )}
      {isDataset && savedDataset?.status === 'active' && (
        <Alert severity="success" variant="outlined" sx={{ mx: 1.5, mt: 1, py: 0 }}>
          {savedDataset.id} is active — referenceable as a source in another dataset, as a calc
          dataset-value, and as an allocation pool cost base. Editing the canvas and saving creates a
          new draft version (re-test + re-approval).
        </Alert>
      )}

      {/* ---- 3-pane shell + dock ---- */}
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Box sx={{ width: 264, borderRight: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <NodePalette model={model} />
        </Box>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <Canvas model={model} />
          </Box>
          <Divider />
          <Box sx={{ height: 220, minHeight: 220 }}>
            <ResultsDock model={model} />
          </Box>
        </Box>
        <Box sx={{ width: 300, borderLeft: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <NodeInspector model={model} />
        </Box>
      </Box>
    </Box>
  );
}
