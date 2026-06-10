import { useEffect, useMemo, useState } from 'react';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useToast } from '@/shared/providers/DataProvider';
import { formatNumber } from '@/shared/utils/format';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import type { ProvenanceKind } from '@/kernel/audit/ProvenanceChip';
import KpiStrip from '@/kernel/shell/KpiStrip';
import type {
  BindingCtx, KpiItem, ProcessBinding,
} from '../types';
import type {
  Parameter, CatalogEntry, Provenance, ProvenanceRollup,
} from '@/shared/api/types';

/** OTP-49 — Data & calculation management console. The governance surface over
 *  the Phase-2 subsystem: the parameter store (state/parameters.py), the data
 *  catalog (services/catalog.py), and the real-vs-fabricated provenance rollup.
 *  Every parameter edit PATCHes /api/parameters/{key} and is hash-chained at
 *  record_ref="param:{key}", so the shell Audit tab + /evidence/param:{key}
 *  packet light up automatically — no extra wiring. No figures are invented
 *  here: every number is read from the governed store it manages. */

// ---- shared helpers ----

/** Map the catalog/parameter `provenance` field onto the ProvenanceChip kind. */
const provKind = (p: Provenance | null | undefined): ProvenanceKind =>
  p === 'real' || p === 'fabricated' ? p : 'assumed';

/** Render a JSON value (scalar | list | dict) compactly for a table cell. */
function valueText(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const CATALOG_KINDS: { key: string; label: string }[] = [
  { key: 'warehouse', label: 'Warehouse (DuckDB / parquet)' },
  { key: 'state', label: 'State (SQLite — governed actions)' },
  { key: 'seed', label: 'Reference seeds' },
  { key: 'parameter', label: 'Calc parameters' },
];

const PROV_META: Record<Provenance, { label: string; hint: string }> = {
  real: { label: 'Real', hint: 'Verifiable warehouse / governed-state figures' },
  assumed: { label: 'Assumed', hint: 'Illustrative reference applied over the real base' },
  fabricated: { label: 'Fabricated', hint: 'Magnitudes invented for the demo' },
};

// ---- data hooks ----

function useParameters() {
  const [params, setParams] = useState<Parameter[] | null>(null);
  const refresh = () =>
    api.parameters().then(setParams).catch(() => setParams([]));
  useEffect(() => { void refresh(); }, []);
  return { params, refresh };
}

function useCatalog() {
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  useEffect(() => {
    api.catalog().then(setEntries).catch(() => setEntries([]));
  }, []);
  return entries;
}

function useProvenance() {
  const [roll, setRoll] = useState<ProvenanceRollup | null>(null);
  useEffect(() => {
    api.catalogProvenance().then(setRoll).catch(() => setRoll(null));
  }, []);
  return roll;
}

// ---------------- KPIs ----------------

const Kpis: FC<BindingCtx> = () => {
  const { params } = useParameters();
  const roll = useProvenance();
  const fabricated = (params ?? []).filter((p) => p.provenance === 'fabricated').length;
  const sources = roll?.total ?? 0;
  const warehouse =
    roll
      ? Object.values(roll.buckets).reduce(
          (s, b) => s + b.items.filter((i) => i.kind === 'warehouse').length,
          0,
        )
      : 0;
  const items: KpiItem[] = [
    { key: 'params', label: 'Governed parameters', value: String(params?.length ?? 0), tone: 'ok', provenance: 'parameters' },
    { key: 'fab', label: 'Fabricated magnitudes', value: String(fabricated), tone: fabricated ? 'watch' : 'ok', provenance: 'catalog · provenance' },
    { key: 'src', label: 'Catalogued data sources', value: String(sources), provenance: 'catalog' },
    { key: 'wh', label: 'Warehouse tables', value: String(warehouse), provenance: 'catalog · warehouse' },
  ];
  return <KpiStrip items={items} />;
};

// ---------------- Parameters tab (overview / inputs) ----------------

function EditDialog({
  param, onClose, onSaved,
}: {
  param: Parameter;
  onClose: () => void;
  onSaved: () => void;
}) {
  const user = useSessionUser();
  const toast = useToast();
  const navigate = useNavigate();
  const [value, setValue] = useState<string>(valueText(param.value));
  const [rationale, setRationale] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const isStructured = param.type === 'list' || param.type === 'dict';
  const isFabricated = param.provenance === 'fabricated';

  // Parse the edited text back to the parameter's JSON shape.
  const parsed = useMemo<{ ok: boolean; value: unknown; err?: string }>(() => {
    const raw = value.trim();
    try {
      if (param.type === 'number') {
        if (raw === '' || Number.isNaN(Number(raw))) return { ok: false, value: null, err: 'Enter a number' };
        return { ok: true, value: Number(raw) };
      }
      if (param.type === 'string') return { ok: true, value: raw };
      // list / dict / unknown → parse as JSON
      return { ok: true, value: JSON.parse(raw) };
    } catch (e) {
      return { ok: false, value: null, err: `Invalid JSON: ${String(e)}` };
    }
  }, [value, param.type]);

  const save = async () => {
    if (!parsed.ok) return;
    setSaving(true);
    try {
      await api.patchParameter(param.key, {
        value: parsed.value,
        actor: user.id,
        rationale: rationale.trim() || `Edited ${param.key} via the management console`,
      });
      toast.show(`Saved ${param.key} — recorded at param:${param.key}`, 'success');
      onSaved();
      onClose();
    } catch (e) {
      toast.show(`Save failed: ${String(e)}`, 'error');
    } finally {
      setSaving(false);
      setConfirm(false);
    }
  };

  const onSaveClick = () => {
    if (isFabricated) { setConfirm(true); return; }
    void save();
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          <Typography variant="h6" component="span" sx={{ fontFamily: 'monospace' }}>{param.key}</Typography>
          <ProvenanceChip source={param.provenance ?? 'assumed'} kind={provKind(param.provenance)} />
          {param.category && <Chip size="small" label={param.category} />}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {param.rationale && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{param.rationale}</Typography>
          )}
          <TextField
            label={isStructured ? `Value (JSON ${param.type})` : `Value (${param.type ?? 'text'})`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            fullWidth
            multiline={isStructured}
            minRows={isStructured ? 3 : undefined}
            error={!parsed.ok}
            helperText={!parsed.ok ? parsed.err : `Default: ${valueText(param.default)}`}
            sx={isStructured ? { '& textarea': { fontFamily: 'monospace', fontSize: 13 } } : undefined}
          />
          {(param.min_value != null || param.max_value != null) && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Bounds: {param.min_value ?? '−∞'} … {param.max_value ?? '∞'}
            </Typography>
          )}
          <TextField
            label="Rationale (recorded in the audit trail)"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            fullWidth
            placeholder="Why is this changing?"
          />
          <Alert severity="info" variant="outlined">
            Saving hash-chains the change at <b>param:{param.key}</b>. The Audit tab and the{' '}
            <Button size="small" onClick={() => navigate(`/evidence/${encodeURIComponent(`param:${param.key}`)}`)}>
              evidence packet
            </Button>{' '}
            update automatically.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          onClick={onSaveClick}
          disabled={!parsed.ok || saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>

      {/* Light maker-checker guard for fabricated magnitudes — a confirm gate. */}
      <Dialog open={confirm} onClose={() => setConfirm(false)} maxWidth="xs">
        <DialogTitle>Edit a fabricated magnitude?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            <b>{param.key}</b> is a <b>fabricated</b> demo magnitude (no warehouse source). Editing it
            changes every figure derived from it. The change is recorded against you at param:{param.key}.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={() => void save()}>Confirm &amp; save</Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

const Parameters: FC<BindingCtx> = () => {
  const { params, refresh } = useParameters();
  const user = useSessionUser();
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Parameter | null>(null);

  if (params === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const reset = async (p: Parameter) => {
    try {
      await api.resetParameter(p.key, { actor: user.id });
      toast.show(`Reset ${p.key} to default`, 'success');
      void refresh();
    } catch (e) {
      toast.show(`Reset failed: ${String(e)}`, 'error');
    }
  };

  const isChanged = (p: Parameter) => valueText(p.value) !== valueText(p.default);

  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        The governed parameter store — every calc magnitude that used to be a hardcoded literal scattered
        across routers (CSA growth/PCT, the BEAT §59A thresholds and RACCT→payment-type map, the
        reconciliation tolerance, …) lives here as one editable, auditable row. Each edit hash-chains at{' '}
        <b>param:&#123;key&#125;</b>; the Audit tab and the per-key evidence packet light up automatically.
      </Alert>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Parameter</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Provenance</TableCell>
              <TableCell>Current value</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {params.map((p) => (
              <TableRow key={p.key} hover>
                <TableCell sx={{ maxWidth: 280 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{p.key}</Typography>
                  {p.process_id && (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{p.process_id}</Typography>
                  )}
                </TableCell>
                <TableCell>{p.category && <Chip size="small" label={p.category} />}</TableCell>
                <TableCell>
                  <ProvenanceChip
                    source={p.provenance ?? 'assumed'}
                    kind={provKind(p.provenance)}
                    tooltip={PROV_META[provKind(p.provenance)].hint}
                  />
                </TableCell>
                <TableCell sx={{ maxWidth: 260 }}>
                  <Typography
                    variant="body2"
                    sx={{ fontFamily: 'monospace', fontWeight: 600, overflowWrap: 'anywhere' }}
                  >
                    {valueText(p.value)}
                  </Typography>
                  {isChanged(p) && (
                    <Chip size="small" color="warning" label="changed" sx={{ height: 18, fontSize: 10, mt: 0.5 }} />
                  )}
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button size="small" variant="outlined" onClick={() => setEditing(p)}>Edit</Button>
                    {isChanged(p) && (
                      <Button size="small" onClick={() => void reset(p)}>Reset</Button>
                    )}
                    <Button
                      size="small"
                      onClick={() => navigate(`/evidence/${encodeURIComponent(`param:${p.key}`)}`)}
                    >
                      Audit
                    </Button>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {editing && (
        <EditDialog param={editing} onClose={() => setEditing(null)} onSaved={() => void refresh()} />
      )}
    </Stack>
  );
};

// ---------------- Data Catalog tab (calculation) ----------------

const DataCatalog: FC<BindingCtx> = () => {
  const entries = useCatalog();
  const navigate = useNavigate();
  if (entries === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  return (
    <Stack spacing={3}>
      <Alert severity="info" variant="outlined">
        The governed data catalog — every source the platform reads, stitched from four tiers: the read-only
        warehouse views, the mutable SQLite state, the reference seeds, and the calc parameters. Each row
        carries its provenance and the processes that consume it (lineage).
      </Alert>
      {CATALOG_KINDS.map(({ key, label }) => {
        const rows = entries.filter((e) => e.kind === key);
        if (!rows.length) return null;
        return (
          <Box key={key}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              {label} <Chip size="small" label={rows.length} sx={{ ml: 0.5, height: 18 }} />
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell>Provenance</TableCell>
                    <TableCell>Lineage (consuming processes)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((e) => (
                    <TableRow key={e.id} hover>
                      <TableCell sx={{ fontWeight: 700, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{e.name}</TableCell>
                      <TableCell sx={{ maxWidth: 360, color: 'text.secondary' }}>{e.description ?? '—'}</TableCell>
                      <TableCell>
                        <ProvenanceChip
                          source={e.provenance ?? 'assumed'}
                          kind={provKind(e.provenance)}
                          tooltip={PROV_META[provKind(e.provenance)].hint}
                          onClick={
                            e.kind === 'parameter'
                              ? () => navigate(`/evidence/${encodeURIComponent(`param:${e.name}`)}`)
                              : undefined
                          }
                        />
                      </TableCell>
                      <TableCell sx={{ maxWidth: 320, color: 'text.secondary' }}>{e.lineage ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        );
      })}
    </Stack>
  );
};

// ---------------- Provenance dashboard tab (outputs) ----------------

const PROV_ORDER: Provenance[] = ['fabricated', 'assumed', 'real'];

const ProvenanceDashboard: FC<BindingCtx> = () => {
  const roll = useProvenance();
  const navigate = useNavigate();
  if (roll === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const pct = (n: number) => (roll.total ? ((n / roll.total) * 100).toFixed(0) : '0');

  return (
    <Stack spacing={3}>
      <Alert severity="info" variant="outlined">
        Real-vs-fabricated rollup across every governed source. {formatNumber(roll.total)} sources in total.
        The fabricated bucket is the honest inventory of every magnitude invented for the demo — treasury
        principals, WHT treaty rates, the CbCR table, allocation keys, the guarantee / captive / customs /
        VAT / FX seeds, and the BEAT RACCT→payment-type map — each deep-linking to its catalog entry.
      </Alert>

      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2 }}>
        {PROV_ORDER.map((p) => {
          const b = roll.buckets[p];
          return (
            <Paper key={p} variant="outlined" sx={{ p: 2, minWidth: 180, flex: 1 }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <ProvenanceChip source={PROV_META[p].label} kind={p} />
              </Stack>
              <Typography variant="h4" sx={{ fontWeight: 800, mt: 1 }}>{b?.count ?? 0}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {pct(b?.count ?? 0)}% of sources · {PROV_META[p].hint}
              </Typography>
            </Paper>
          );
        })}
      </Stack>

      {PROV_ORDER.map((p) => {
        const b = roll.buckets[p];
        if (!b || !b.count) return null;
        return (
          <Box key={p}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              <ProvenanceChip source={PROV_META[p].label} kind={p} /> {' '}
              <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>— {b.count} source(s)</Box>
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Source</TableCell>
                    <TableCell>Kind</TableCell>
                    <TableCell align="right">Catalog id</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {b.items.map((it) => (
                    <TableRow
                      key={it.id}
                      hover
                      sx={{ cursor: it.kind === 'parameter' ? 'pointer' : 'default' }}
                      onClick={
                        it.kind === 'parameter'
                          ? () => navigate(`/evidence/${encodeURIComponent(`param:${it.name}`)}`)
                          : undefined
                      }
                    >
                      <TableCell sx={{ fontWeight: 700, fontFamily: 'monospace' }}>{it.name}</TableCell>
                      <TableCell><Chip size="small" label={it.kind} /></TableCell>
                      <TableCell align="right" sx={{ color: 'text.secondary', fontFamily: 'monospace', fontSize: 12 }}>{it.id}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        );
      })}
    </Stack>
  );
};

export const otp49: ProcessBinding = {
  kpis: Kpis,
  tabs: {
    overview: Parameters,
    inputs: Parameters,
    calculation: DataCatalog,
    outputs: ProvenanceDashboard,
  },
};
