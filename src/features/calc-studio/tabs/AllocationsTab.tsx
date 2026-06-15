import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
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
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DownloadIcon from '@mui/icons-material/Download';
import { api } from '@/shared/api/client';
import { useToast } from '@/shared/providers/DataProvider';
import type {
  AllocationArtifact,
  AllocationCharge,
  AllocationEntityRow,
  AllocationExceptionReport,
  AllocationExclusionRow,
  AllocationKeyDef,
  AllocationMarkupPolicy,
  AllocationPool,
  AllocationRecon,
  AllocationRun,
  AllocationRunLaunch,
  AllocationRunType,
  AllocationSeed,
} from '@/shared/api/types';
import AllocationChargeDrawer from '../components/AllocationChargeDrawer';
import PoolBuilder from '../components/PoolBuilder';
import { fmtAmount, fmtPct, isNonZero, sumCents } from '../allocationLib';

/** Allocations — the allocation engine workbench (M7, ADAPTATION D4). One tab
 *  over the SPEC §4 pipeline: launch runs (POST /api/allocation/runs), read the
 *  pools/policies/keys/exclusions reference sheets (read-only seeds generated
 *  from the warehouse), tie out the recon (pooled = exclusions + recovered +
 *  residual 0 — V-X1), read the V-rule exception report, drill ledger charges
 *  to their constituent cost lines, and download the run's doc pack. Every
 *  figure is read from the engine's API — amounts are exact decimal strings
 *  rendered without float math (see ../allocationLib.ts). */

const ACTOR = 'u_demo';

const VIEWS = [
  { key: 'console', label: 'Run console' },
  { key: 'pools', label: 'Pools & policies' },
  { key: 'recon', label: 'Recon' },
  { key: 'exceptions', label: 'Exceptions' },
  { key: 'charges', label: 'Charges' },
  { key: 'docs', label: 'Doc packs' },
  { key: 'build', label: 'Build pool' },
] as const;
type ViewKey = (typeof VIEWS)[number]['key'];

const RUN_TYPE_LABEL: Record<AllocationRunType, string> = {
  actual: 'Run actual',
  budget: 'Run budget',
  trueup: 'Run true-up',
};

// ---------------------------------------------------------------- data hooks --

/** The engine's reference sheets — read-only seeds served by /api/reference
 *  (generated from the warehouse by seeds/allocation/generate_seeds.py). */
function useAllocationSeeds() {
  const [pools, setPools] = useState<AllocationPool[] | null>(null);
  const [policies, setPolicies] = useState<AllocationMarkupPolicy[]>([]);
  const [keyDefs, setKeyDefs] = useState<AllocationKeyDef[]>([]);
  const [exclusions, setExclusions] = useState<AllocationExclusionRow[]>([]);
  const [entities, setEntities] = useState<AllocationEntityRow[]>([]);
  useEffect(() => {
    let alive = true;
    const rows = <T,>(name: string): Promise<T[]> =>
      api.reference<AllocationSeed<T>>(name).then((s) => s.rows).catch(() => []);
    Promise.all([
      rows<AllocationPool>('allocation_pools'),
      rows<AllocationMarkupPolicy>('allocation_markup_policies'),
      rows<AllocationKeyDef>('allocation_key_defs'),
      rows<AllocationExclusionRow>('allocation_exclusions'),
      rows<AllocationEntityRow>('allocation_entities'),
    ]).then(([p, mp, kd, ex, en]) => {
      if (!alive) return;
      setPools(p);
      setPolicies(mp);
      setKeyDefs(kd);
      setExclusions(ex);
      setEntities(en);
    });
    return () => {
      alive = false;
    };
  }, []);
  return { pools, policies, keyDefs, exclusions, entities };
}

// ------------------------------------------------------------ small elements --

function StatusChip({ status }: { status: string }) {
  const color = status === 'succeeded' ? 'success' : status === 'failed' ? 'error' : 'default';
  return <Chip size="small" color={color} label={status} sx={{ height: 20, fontSize: 11 }} />;
}

function SeverityChip({ severity }: { severity: 'BLOCK' | 'WARN' }) {
  return (
    <Chip
      size="small"
      color={severity === 'BLOCK' ? 'error' : 'warning'}
      label={severity}
      sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
    />
  );
}

function HashChip({ hash, prefix }: { hash: string; prefix: string }) {
  return (
    <Tooltip title={`${prefix} ${hash}`} arrow>
      <Chip
        size="small"
        variant="outlined"
        label={hash.slice(0, 12)}
        sx={{ height: 20, fontSize: 11, fontFamily: 'monospace' }}
      />
    </Tooltip>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, minWidth: 150 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      {hint && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{hint}</Typography>}
    </Paper>
  );
}

/** Run selector for the run-scoped sections (recon/exceptions/charges/docs). */
function RunPicker({
  runs,
  runId,
  onChange,
}: {
  runs: AllocationRun[];
  runId: string | null;
  onChange: (id: string) => void;
}) {
  if (runs.length === 0) return null;
  return (
    <TextField
      select
      size="small"
      label="Run"
      value={runId ?? ''}
      onChange={(e) => onChange(e.target.value)}
      sx={{ minWidth: 340 }}
    >
      {[...runs].reverse().map((r) => (
        <MenuItem key={r.run_id} value={r.run_id}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{r.run_id}</Typography>
            <StatusChip status={r.status} />
          </Stack>
        </MenuItem>
      ))}
    </TextField>
  );
}

// -------------------------------------------------------------------- main --

export default function AllocationsTab() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const view: ViewKey = (VIEWS.find((v) => v.key === searchParams.get('view'))?.key ?? 'console') as ViewKey;
  const setView = (v: ViewKey | null) => {
    if (!v) return;
    const next = new URLSearchParams(searchParams);
    next.set('view', v);
    setSearchParams(next, { replace: true });
  };

  const { pools, policies, keyDefs, exclusions, entities } = useAllocationSeeds();
  const entityName = useMemo(
    () => Object.fromEntries(entities.map((e) => [e.entity_id, e.legal_entity_name])),
    [entities],
  );

  // Run registry + the selected run (newest by default; list is seq-ordered).
  const [runs, setRuns] = useState<AllocationRun[] | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  useEffect(() => {
    api
      .allocationRuns()
      .then((rs) => {
        setRuns(rs);
        setRunId((cur) => cur ?? (rs.length ? rs[rs.length - 1].run_id : null));
      })
      .catch(() => setRuns([]));
  }, []);

  // Run-scoped reads, refetched when the selection changes. A failed run has
  // no ledger rows by design (all-or-nothing) — only its exception report.
  const [runData, setRunData] = useState<{
    forRun: string;
    recon: AllocationRecon[];
    exceptions: AllocationExceptionReport | null;
    charges: AllocationCharge[];
    docs: AllocationArtifact[];
  } | null>(null);
  useEffect(() => {
    if (!runId) {
      setRunData(null);
      return;
    }
    let alive = true;
    setRunData(null);
    Promise.all([
      api.allocationRunRecon(runId).catch(() => [] as AllocationRecon[]),
      api.allocationRunExceptions(runId).catch(() => null),
      api.allocationRunCharges(runId).catch(() => [] as AllocationCharge[]),
      api.allocationRunDocs(runId).catch(() => [] as AllocationArtifact[]),
    ]).then(([recon, excepts, charges, docs]) => {
      if (alive) setRunData({ forRun: runId, recon, exceptions: excepts, charges, docs });
    });
    return () => {
      alive = false;
    };
  }, [runId]);

  // Launch console state. Billing periods come from the data (the Stage-3
  // exclusion register's effective months ∪ recorded run periods) — never a
  // hardcoded list.
  const billingPeriods = useMemo(() => {
    const months = new Set<string>();
    exclusions.forEach((e) => months.add(e.effective_from.slice(0, 7)));
    (runs ?? []).forEach((r) => {
      if (r.period.length === 7) months.add(r.period);
    });
    return [...months].sort();
  }, [exclusions, runs]);
  const [period, setPeriod] = useState('');
  useEffect(() => {
    if (!period && billingPeriods.length) setPeriod(billingPeriods[billingPeriods.length - 1]);
  }, [billingPeriods, period]);

  const [launching, setLaunching] = useState<AllocationRunType | null>(null);
  const [lastLaunch, setLastLaunch] = useState<AllocationRunLaunch | null>(null);
  const launch = async (runType: AllocationRunType) => {
    if (!period) return;
    setLaunching(runType);
    try {
      const body =
        runType === 'trueup'
          ? { run_type: runType, actor: ACTOR, year: period.slice(0, 4) }
          : { run_type: runType, actor: ACTOR, period };
      const res = await api.launchAllocationRun(body);
      setLastLaunch(res);
      const fresh = await api.allocationRuns().catch(() => null);
      if (fresh) setRuns(fresh);
      setRunId(res.run_id);
      if (res.status === 'succeeded') {
        toast.show(`Run ${res.run_id} succeeded — recon ${res.summary?.recon_balanced ? 'Balanced' : 'with breaks'}`, 'success');
      } else {
        toast.show(`Run ${res.run_id} failed — ${res.exception_report.counts.BLOCK} BLOCK exception(s) withheld every output`, 'error');
      }
    } catch (e) {
      toast.show(`Launch failed: ${String(e)}`, 'error');
    } finally {
      setLaunching(null);
    }
  };

  const [chargeId, setChargeId] = useState<string | null>(null);

  // Doc-pack page fetch (per selected pool of the selected run).
  const [doc, setDoc] = useState<{ forRun: string; poolId: string; markdown: string } | null>(null);
  const openDoc = async (poolId: string) => {
    if (!runId) return;
    try {
      const d = await api.allocationRunDoc(runId, poolId);
      setDoc({ forRun: runId, poolId, markdown: d.markdown });
    } catch (e) {
      toast.show(`Doc pack load failed: ${String(e)}`, 'error');
    }
  };
  const downloadDoc = () => {
    if (!doc) return;
    const blob = new Blob([doc.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.forRun}-${doc.poolId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (runs === null) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  }

  const selectedRun = runs.find((r) => r.run_id === runId) ?? null;
  const dataReady = runData !== null && runData.forRun === runId;

  // ------------------------------------------------------------- sub-views --

  const consoleView = (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        The allocation engine&apos;s run console (SPEC §4): capture → pool → benefit-test gate →
        allocate → markup → charge-out → reconcile. Each run snapshots and hashes its inputs, persists
        atomically (a BLOCK exception withholds every output) and is audited at{' '}
        <b>allocation:&#123;run_id&#125;</b>; registry runs also land in the job console at{' '}
        <b>calc:service_allocation</b>.
      </Alert>

      {/* Launch row */}
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
          <TextField
            select
            size="small"
            label="Period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            sx={{ minWidth: 140 }}
            helperText="Billing periods from the dataset"
          >
            {billingPeriods.map((p) => (
              <MenuItem key={p} value={p}>{p}</MenuItem>
            ))}
          </TextField>
          {(['actual', 'budget', 'trueup'] as AllocationRunType[]).map((t) => (
            <Button
              key={t}
              variant={t === 'actual' ? 'contained' : 'outlined'}
              size="small"
              disabled={launching !== null || !period}
              startIcon={launching === t ? <CircularProgress size={14} color="inherit" /> : <PlayArrowIcon />}
              onClick={() => void launch(t)}
            >
              {launching === t ? 'Running…' : RUN_TYPE_LABEL[t]}
            </Button>
          ))}
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            True-up runs the whole year ({period ? period.slice(0, 4) : '—'}) on actuals and nets the
            booked Budget charges (SPEC §5.4).
          </Typography>
        </Stack>
      </Paper>

      {lastLaunch && (
        <Alert
          severity={lastLaunch.status === 'succeeded' ? 'success' : 'error'}
          variant="outlined"
          onClose={() => setLastLaunch(null)}
          action={
            lastLaunch.status === 'failed' ? (
              <Button color="inherit" size="small" onClick={() => setView('exceptions')}>
                View exceptions
              </Button>
            ) : undefined
          }
        >
          {lastLaunch.run_id} — {lastLaunch.status}
          {lastLaunch.summary
            ? ` · ${lastLaunch.summary.charges} charge(s) · ${fmtAmount(lastLaunch.summary.total_charged_out)} charged out · ${lastLaunch.exception_report.counts.WARN} warn(s)`
            : ` · ${lastLaunch.exception_report.counts.BLOCK} BLOCK / ${lastLaunch.exception_report.counts.WARN} WARN`}
        </Alert>
      )}

      {runs.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>No allocation runs yet</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            Pick a billing period and press “Run actual” — the run lands here with its input-snapshot hash.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Run</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Period</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Input hash</TableCell>
                <TableCell align="right">Charges</TableCell>
                <TableCell align="right">Charged out</TableCell>
                <TableCell align="right">Blocks / warns</TableCell>
                <TableCell align="right">Evidence</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {[...runs].reverse().map((r) => (
                <TableRow
                  key={r.run_id}
                  hover
                  selected={r.run_id === runId}
                  sx={{ cursor: 'pointer' }}
                  onClick={() => setRunId(r.run_id)}
                >
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>
                      {r.run_id}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {new Date(r.started_at).toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={r.run_type} sx={{ height: 20, fontSize: 11 }} />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.period}</TableCell>
                  <TableCell><StatusChip status={r.status} /></TableCell>
                  <TableCell><HashChip hash={r.input_snapshot_hash} prefix="input snapshot sha256" /></TableCell>
                  <TableCell align="right">{r.summary ? r.summary.charges : '—'}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {r.summary ? fmtAmount(r.summary.total_charged_out) : '—'}
                  </TableCell>
                  <TableCell align="right">
                    {r.summary ? `${r.summary.blocks} / ${r.summary.warns}` : '—'}
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/evidence/${encodeURIComponent('calc:service_allocation')}`);
                      }}
                    >
                      Evidence
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {selectedRun && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>Selected:</Typography>
            <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{selectedRun.run_id}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              engine v{selectedRun.engine_version} · schema {selectedRun.schema_version}
            </Typography>
            {selectedRun.summary && <HashChip hash={selectedRun.summary.output_hash} prefix="output sha256" />}
            <Button
              size="small"
              onClick={() => navigate(`/evidence/${encodeURIComponent(`allocation:${selectedRun.run_id}`)}`)}
            >
              Run audit
            </Button>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              — the Recon, Exceptions, Charges and Doc packs sections read this run.
            </Typography>
          </Stack>
        </Paper>
      )}
    </Stack>
  );

  const poolsView = (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        The engine&apos;s reference sheets — pools, jurisdiction markup policies, allocation-key
        definitions and benefit-test exclusions. Read-only seeds generated from the warehouse
        (reconciliation by construction); the stewardship exclusions are carried line-for-line from
        the <b>OTP-15</b> register into the Stage-3 gate.
      </Alert>
      {pools === null ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : (
        pools.map((p) => {
          const poolPolicies = policies.filter((mp) => mp.pool_id === p.pool_id);
          const poolExclusions = exclusions.filter((ex) => ex.pool_id === p.pool_id);
          const key = keyDefs.find((k) => k.key_id === p.default_key_id);
          return (
            <Paper key={p.pool_id} variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction="row" alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5, mb: 0.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{p.pool_name}</Typography>
                <Chip size="small" variant="outlined" label={p.pool_id} sx={{ height: 20, fontSize: 11, fontFamily: 'monospace' }} />
                <Chip size="small" label={p.characterization} sx={{ height: 20, fontSize: 11 }} />
                <Chip size="small" variant="outlined" label={p.service_line} sx={{ height: 20, fontSize: 11 }} />
              </Stack>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                {p.service_description}
              </Typography>
              <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', gap: 1, mb: 1 }}>
                <Typography variant="body2">
                  <b>Provider</b> {p.provider_entity_id} · {entityName[p.provider_entity_id] ?? ''}
                </Typography>
                <Typography variant="body2">
                  <b>Key</b> {key ? `${key.key_name} (${key.key_factor}, ${key.static_or_dynamic.toLowerCase()})` : p.default_key_id}
                </Typography>
              </Stack>
              {key && (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                  Key source: {key.source_system}
                </Typography>
              )}
              {poolPolicies.length > 0 && (
                <Stack direction="row" alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5, mb: poolExclusions.length ? 1 : 0 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                    Markup policies
                  </Typography>
                  {poolPolicies.map((mp) => (
                    <Tooltip
                      key={mp.markup_policy_id}
                      arrow
                      title={
                        mp.benchmark_study_ref
                          ? `Benchmarked study ${mp.benchmark_study_ref} (full-precision rate ${mp.markup_pct})`
                          : `${mp.regime} — regime-fixed rate`
                      }
                    >
                      <Chip
                        size="small"
                        variant="outlined"
                        color={mp.benchmark_study_ref ? 'primary' : undefined}
                        label={`${mp.jurisdiction} · ${mp.regime} · ${fmtPct(mp.markup_pct)}`}
                        sx={{ height: 22, fontSize: 11 }}
                      />
                    </Tooltip>
                  ))}
                </Stack>
              )}
              {poolExclusions.length > 0 && (
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, display: 'block' }}>
                    Stage-3 benefit-test exclusions
                  </Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Period</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell align="right">Amount</TableCell>
                        <TableCell>Basis</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {poolExclusions.map((ex) => (
                        <TableRow key={ex.exclusion_id} hover>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{ex.effective_from.slice(0, 7)}</TableCell>
                          <TableCell>{ex.exclusion_type}</TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {ex.exclusion_amount ? fmtAmount(ex.exclusion_amount) : fmtPct(ex.exclusion_pct)}
                          </TableCell>
                          <TableCell sx={{ maxWidth: 420 }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{ex.basis_rationale}</Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Stack direction="row" alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      Carried from the OTP-15 stewardship register (fixed-amount, per billing period) —
                      OECD TPG 7.9–7.10 shareholder costs never enter the chargeable base.
                    </Typography>
                    <Button size="small" onClick={() => navigate('/process/OTP-15')}>
                      Open the OTP-15 register
                    </Button>
                  </Stack>
                </Box>
              )}
            </Paper>
          );
        })
      )}
    </Stack>
  );

  const reconRows = dataReady ? runData.recon : [];
  const hasTrueUp = reconRows.some((r) => r.true_up_delta !== null);
  const reconView = (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
        <RunPicker runs={runs} runId={runId} onChange={setRunId} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Per (pool, provider, period): pooled = exclusions + recovered + residual — V-X1 holds the
          residual to a hard zero, so Balanced means tied out to the cent, not rounded.
        </Typography>
      </Stack>
      {!dataReady ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : reconRows.length === 0 ? (
        <Alert severity="info" variant="outlined">
          No recon rows for this run — a failed run persists only its exception report
          (all-or-nothing per run).
        </Alert>
      ) : (
        <>
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Kpi label="Pools" value={String(reconRows.length)} />
            <Kpi
              label="Balanced"
              value={`${reconRows.filter((r) => r.recon_status === 'Balanced').length} / ${reconRows.length}`}
              hint="V-X1 zero residual"
            />
            <Kpi
              label="Charged out"
              value={fmtAmount(sumCents(reconRows.map((r) => r.total_charged_out)))}
              hint="Σ gross, provider currency"
            />
            {hasTrueUp && (
              <Kpi
                label="True-up Σ delta"
                value={fmtAmount(sumCents(reconRows.map((r) => r.true_up_delta)))}
                hint="actual year − booked budget"
              />
            )}
          </Stack>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Pool</TableCell>
                  <TableCell>Provider</TableCell>
                  <TableCell>Period</TableCell>
                  <TableCell align="right">Pooled</TableCell>
                  <TableCell align="right">Exclusions</TableCell>
                  <TableCell align="right">Recovered</TableCell>
                  <TableCell align="right">Markup</TableCell>
                  <TableCell align="right">Charged out</TableCell>
                  <TableCell align="right">Residual</TableCell>
                  {hasTrueUp && <TableCell align="right">True-up Δ</TableCell>}
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reconRows.map((r) => (
                  <TableRow key={r.recon_id} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{r.pool_id}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {r.provider_entity_id} {entityName[r.provider_entity_id] ? `· ${entityName[r.provider_entity_id]}` : ''}
                    </TableCell>
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
                    {hasTrueUp && (
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {r.true_up_delta !== null ? fmtAmount(r.true_up_delta) : '—'}
                      </TableCell>
                    )}
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
        </>
      )}
    </Stack>
  );

  const report = dataReady ? runData.exceptions : null;
  const exceptionsView = (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
        <RunPicker runs={runs} runId={runId} onChange={setRunId} />
        {report && (
          <>
            <Chip size="small" color="error" label={`BLOCK ${report.counts.BLOCK}`} sx={{ height: 22, fontWeight: 700 }} />
            <Chip size="small" color="warning" label={`WARN ${report.counts.WARN}`} sx={{ height: 22, fontWeight: 700 }} />
          </>
        )}
      </Stack>
      {!dataReady ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : report === null ? (
        <Alert severity="info" variant="outlined">No exception report for this run.</Alert>
      ) : report.exceptions.length === 0 ? (
        <Alert severity="success" variant="outlined">
          No V-rules fired — every referential, pooling, benefit-test, key, markup and reconciliation
          check (SPEC §7) passed for this run.
        </Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Rule</TableCell>
                <TableCell>Severity</TableCell>
                <TableCell>Pool</TableCell>
                <TableCell>Message</TableCell>
                <TableCell>Remediation</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {report.exceptions.map((e, i) => (
                <TableRow key={`${e.rule_id}-${i}`} hover>
                  <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700, whiteSpace: 'nowrap' }}>{e.rule_id}</TableCell>
                  <TableCell><SeverityChip severity={e.severity} /></TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{e.pool_id ?? '—'}</TableCell>
                  <TableCell sx={{ maxWidth: 380 }}>
                    <Typography variant="body2" sx={{ fontSize: 13 }}>{e.message}</Typography>
                    {e.objects.length > 0 && (
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
                        {e.objects.join(' · ')}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 320 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{e.remediation}</Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );

  const charges = dataReady ? runData.charges : [];
  const chargesView = (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
        <RunPicker runs={runs} runId={runId} onChange={setRunId} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          The append-only charge ledger — click a row to drill to its allocation ratio, key value and
          constituent cost lines.
        </Typography>
      </Stack>
      {!dataReady ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : charges.length === 0 ? (
        <Alert severity="info" variant="outlined">
          No ledger charges for this run (a failed run writes none; a zero-base period charges nothing).
        </Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Charge</TableCell>
                <TableCell>Pool</TableCell>
                <TableCell>Provider → recipient</TableCell>
                <TableCell>Period</TableCell>
                <TableCell>B / A</TableCell>
                <TableCell align="right">Cost</TableCell>
                <TableCell align="right">Markup</TableCell>
                <TableCell align="right">Gross</TableCell>
                <TableCell>Ccy</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {charges.map((c) => {
                const engineId = c.charge_id.includes(':')
                  ? c.charge_id.slice(c.charge_id.indexOf(':') + 1)
                  : c.charge_id;
                return (
                  <TableRow key={c.charge_id} hover sx={{ cursor: 'pointer' }} onClick={() => setChargeId(c.charge_id)}>
                    <TableCell sx={{ maxWidth: 280 }}>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12, overflowWrap: 'anywhere' }}>
                        {engineId}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{c.pool_id}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{c.provider_entity_id} → {c.recipient_entity_id}</TableCell>
                    <TableCell>{c.period}</TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={c.budget_or_actual} sx={{ height: 20, fontSize: 11 }} />
                    </TableCell>
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
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );

  const docIndex = dataReady ? runData.docs : [];
  const docsView = (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
        <RunPicker runs={runs} runId={runId} onChange={setRunId} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Documentation is a byproduct of the run (SPEC §8.3) — one generated Markdown page per pool,
          stored as a run artifact.
        </Typography>
      </Stack>
      {!dataReady ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : docIndex.length === 0 ? (
        <Alert severity="info" variant="outlined">No doc pack for this run (failed runs persist only their exception report).</Alert>
      ) : (
        <>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
            {docIndex.map((d) => {
              const poolId = d.name.replace(/^docs\//, '').replace(/\.md$/, '');
              const active = doc !== null && doc.forRun === runId && doc.poolId === poolId;
              return (
                <Button
                  key={d.name}
                  size="small"
                  variant={active ? 'contained' : 'outlined'}
                  onClick={() => void openDoc(poolId)}
                >
                  {poolId}
                </Button>
              );
            })}
            {doc && doc.forRun === runId && (
              <Button size="small" startIcon={<DownloadIcon />} onClick={downloadDoc}>
                Download {doc.poolId}.md
              </Button>
            )}
          </Stack>
          {doc && doc.forRun === runId ? (
            <Box
              component="pre"
              sx={{
                fontFamily: 'monospace',
                fontSize: 12.5,
                bgcolor: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: 1,
                p: 2,
                m: 0,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {doc.markdown}
            </Box>
          ) : (
            <Alert severity="info" variant="outlined">Pick a pool to read its run-scoped documentation page.</Alert>
          )}
        </>
      )}
    </Stack>
  );

  return (
    <Stack spacing={2}>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={view}
        onChange={(_, v: ViewKey | null) => setView(v)}
      >
        {VIEWS.map((v) => (
          <ToggleButton key={v.key} value={v.key} sx={{ textTransform: 'none', px: 1.5 }}>
            {v.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {view === 'console' && consoleView}
      {view === 'pools' && poolsView}
      {view === 'recon' && reconView}
      {view === 'exceptions' && exceptionsView}
      {view === 'charges' && chargesView}
      {view === 'docs' && docsView}
      {view === 'build' && <PoolBuilder entities={entities} />}
      <AllocationChargeDrawer chargeId={chargeId} onClose={() => setChargeId(null)} />
    </Stack>
  );
}
