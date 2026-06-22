import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Divider, IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { api } from '@/shared/api/client';
import { fmtAmount } from '../allocationLib';
import type {
  AllocationDimensionOption,
  AllocationDimensions,
  AllocationEntityRow,
  AuthoredDataset,
  AuthoredExclusion,
  AuthoredMarkupPolicy,
  StagePreviewResult,
} from '@/shared/api/types';
import { stageResultText } from './resultText';
import type { GraphModel, RFNode } from './useGraphModel';

/** Inline stage inspector (Phase 7 MC3) — the right-pane config for an
 *  allocation STAGE node. No modal dialogs: the same field logic the Pool
 *  Builder offers (cost-capture dimension pickers, beneficiaries, key factor,
 *  exclusions, per-jurisdiction markup) is rendered inline and patches the
 *  selected stage node's config in place. Editing the stage IS editing the
 *  authored-pool definition the graph compiles to. The cost-capture pickers and
 *  the markup % numeric input show a calc-bound badge when a calc-value subgraph
 *  feeds the handle (the literal then acts only as a structural fallback). */

const KEY_FACTORS = ['Equal', 'Revenue', 'Cost'] as const;
const EXCLUSION_TYPES = ['Stewardship', 'Pass-through', 'Duplicative', 'Shareholder', 'Other'];

interface CaptureRule {
  cost_centers?: string[] | null;
  profit_centers?: string[] | null;
  cost_elements?: string[] | null;
  split_pct?: string | null;
  /** DS3: an active authored dataset supplies the cost base (then the CC/PC/
   *  element pickers act only as an optional further filter). */
  dataset_id?: string | null;
}

function DimensionPicker({
  label, options, value, onChange,
}: {
  label: string;
  options: AllocationDimensionOption[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <TextField
      select size="small" label={label} value={value}
      onChange={(e) =>
        onChange(typeof e.target.value === 'string' ? [e.target.value] : (e.target.value as unknown as string[]))
      }
      SelectProps={{ multiple: true, renderValue: (sel) => `${(sel as string[]).length} selected` }}
      fullWidth
      helperText={`${options.length} available`}
    >
      {options.map((o) => (
        <MenuItem key={o.value} value={o.value}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
            <Typography variant="body2" sx={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}>{o.value}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
              {fmtAmount(o.total_cost)}
            </Typography>
          </Stack>
        </MenuItem>
      ))}
    </TextField>
  );
}

export default function StageInspector({
  model, node,
}: {
  model: GraphModel;
  node: RFNode;
}) {
  const { updateNodeConfig, edges, stagePreview } = model;
  const kind = node.data.kind;
  const config = node.data.config as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => updateNodeConfig(node.id, patch);

  const [dims, setDims] = useState<AllocationDimensions | null>(null);
  const [entities, setEntities] = useState<AllocationEntityRow[]>([]);
  const [activeDatasets, setActiveDatasets] = useState<AuthoredDataset[]>([]);
  useEffect(() => {
    api.allocationDimensions().then(setDims).catch(() => setDims(null));
    api.reference<{ rows: AllocationEntityRow[] }>('allocation_entities')
      .then((s) => setEntities(s.rows))
      .catch(() => setEntities([]));
    api.authoredDatasets('active').then(setActiveDatasets).catch(() => setActiveDatasets([]));
  }, []);

  // Is a numeric input handle of this stage bound to a calc-value subgraph?
  const boundHandles = useMemo(() => {
    const s = new Set<string>();
    edges.forEach((e) => {
      if (e.target === node.id && e.targetHandle && e.targetHandle !== 'in') s.add(e.targetHandle);
    });
    return s;
  }, [edges, node.id]);

  const sv = stagePreview?.stages?.[node.id] as StagePreviewResult | undefined;
  const rule = (config.cost_capture_rule as CaptureRule) ?? {};
  const setRule = (patch: Partial<CaptureRule>) =>
    set({ cost_capture_rule: { ...rule, ...patch } });

  const exclusions = (config.exclusions as AuthoredExclusion[]) ?? [];
  const markups = (config.markup_policies as AuthoredMarkupPolicy[]) ?? [];

  return (
    <Stack spacing={1.5}>
      {/* ---- source: cost-capture rule ---- */}
      {kind === 'source' && (
        dims === null ? (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>Loading dimensions…</Typography>
        ) : (
          <>
            {/* DS3: an active authored dataset as the cost base (vs the seed cost
                lines). When set, the dimension pickers become an optional filter. */}
            <TextField select size="small" fullWidth label="Cost base (dataset, optional)"
              value={String(rule.dataset_id ?? '')}
              onChange={(e) => setRule({ dataset_id: e.target.value || null })}
              helperText={rule.dataset_id
                ? 'Active dataset supplies the Source-stage cost base (dimension filters optional)'
                : 'Default: the fabricated seed cost lines'}>
              <MenuItem value="">— seed cost lines —</MenuItem>
              {activeDatasets.map((d) => (
                <MenuItem key={d.id} value={d.id}>{d.id} · {d.name}</MenuItem>
              ))}
              {Boolean(rule.dataset_id) && !activeDatasets.some((d) => d.id === rule.dataset_id) && (
                <MenuItem value={String(rule.dataset_id)}>{String(rule.dataset_id)}</MenuItem>
              )}
            </TextField>
            <DimensionPicker label="Cost centers" options={dims.cost_centers}
              value={rule.cost_centers ?? []} onChange={(v) => setRule({ cost_centers: v.length ? v : null })} />
            <DimensionPicker label="Profit centers" options={dims.profit_centers}
              value={rule.profit_centers ?? []} onChange={(v) => setRule({ profit_centers: v.length ? v : null })} />
            <DimensionPicker label="GL accounts (cost elements)" options={dims.cost_elements}
              value={rule.cost_elements ?? []} onChange={(v) => setRule({ cost_elements: v.length ? v : null })} />
            <TextField size="small" fullWidth label="Split % (optional, 0–1)"
              value={String(rule.split_pct ?? '')}
              onChange={(e) => setRule({ split_pct: e.target.value || null })}
              helperText="Fraction of each matched line" />
          </>
        )
      )}

      {/* ---- pool: metadata ---- */}
      {kind === 'pool' && (
        <>
          <TextField size="small" fullWidth label="Pool name"
            value={String(config.name ?? '')} onChange={(e) => set({ name: e.target.value })} />
          <TextField select size="small" fullWidth label="Provider"
            value={String(config.provider_entity_id ?? '')}
            onChange={(e) => set({ provider_entity_id: e.target.value })}>
            {entities.map((en) => (
              <MenuItem key={en.entity_id} value={en.entity_id}>
                {en.entity_id} · {en.legal_entity_name} ({en.jurisdiction})
              </MenuItem>
            ))}
          </TextField>
          <TextField size="small" fullWidth label="Service line"
            value={String(config.service_line ?? '')} onChange={(e) => set({ service_line: e.target.value })} />
          <TextField size="small" fullWidth label="Characterization"
            value={String(config.characterization ?? '')} onChange={(e) => set({ characterization: e.target.value })} />
          <TextField size="small" fullWidth label="Cost-base definition"
            value={String(config.cost_base_definition ?? '')} onChange={(e) => set({ cost_base_definition: e.target.value })} />
        </>
      )}

      {/* ---- benefit_test: beneficiaries + exclusions ---- */}
      {kind === 'benefit_test' && (
        <>
          <TextField select size="small" fullWidth label="Beneficiaries"
            value={(config.beneficiaries as string[]) ?? []}
            onChange={(e) => set({ beneficiaries: typeof e.target.value === 'string' ? [e.target.value] : (e.target.value as unknown as string[]) })}
            SelectProps={{ multiple: true, renderValue: (sel) => (sel as string[]).join(', ') || '—' }}>
            {entities.map((en) => (
              <MenuItem key={en.entity_id} value={en.entity_id}>
                {en.entity_id} · {en.legal_entity_name} ({en.jurisdiction})
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', flex: 1 }}>Exclusions</Typography>
            <Button size="small" startIcon={<AddIcon />}
              onClick={() => set({ exclusions: [...exclusions, { type: EXCLUSION_TYPES[0], amount: '', pct: null, basis_rationale: '' }] })}>
              Add
            </Button>
          </Stack>
          {exclusions.map((ex, i) => {
            const patchEx = (p: Partial<AuthoredExclusion>) =>
              set({ exclusions: exclusions.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            const mode = ex.pct != null ? 'pct' : 'amount';
            return (
              <Stack key={i} spacing={0.5} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
                <Stack direction="row" spacing={0.5}>
                  <TextField select size="small" label="Type" value={ex.type} sx={{ flex: 1 }}
                    onChange={(e) => patchEx({ type: e.target.value })}>
                    {EXCLUSION_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                  </TextField>
                  <TextField select size="small" label="Basis" value={mode} sx={{ width: 100 }}
                    onChange={(e) => patchEx(e.target.value === 'pct' ? { pct: ex.amount ?? '', amount: null } : { amount: ex.pct ?? '', pct: null })}>
                    <MenuItem value="amount">Amount</MenuItem>
                    <MenuItem value="pct">Percent</MenuItem>
                  </TextField>
                  <IconButton size="small" onClick={() => set({ exclusions: exclusions.filter((_, j) => j !== i) })}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
                <TextField size="small" label={mode === 'pct' ? 'Pct (0–1)' : 'Amount'}
                  value={String((mode === 'pct' ? ex.pct : ex.amount) ?? '')}
                  onChange={(e) => patchEx(mode === 'pct' ? { pct: e.target.value } : { amount: e.target.value })} />
                <TextField size="small" label="Basis rationale" value={ex.basis_rationale}
                  onChange={(e) => patchEx({ basis_rationale: e.target.value })} />
              </Stack>
            );
          })}
        </>
      )}

      {/* ---- allocate: key factor (+ optional calc-bound weight) ---- */}
      {kind === 'allocate' && (
        <>
          <TextField select size="small" fullWidth label="Key factor"
            value={String(config.key_factor ?? '')} onChange={(e) => set({ key_factor: e.target.value })}
            helperText="Factor values from the warehouse; engine recomputes the total (V-K3)">
            {KEY_FACTORS.map((k) => <MenuItem key={k} value={k}>{k}</MenuItem>)}
          </TextField>
          {boundHandles.has('weight') && (
            <Alert severity="info" variant="outlined" sx={{ py: 0 }}>
              The <b>weight</b> input is calc-bound — a calc-value subgraph drives it at run time.
            </Alert>
          )}
        </>
      )}

      {/* ---- markup: per-jurisdiction policies (+ optional calc-bound %) ---- */}
      {kind === 'markup' && (
        <>
          {boundHandles.has('pct') && (
            <Alert severity="info" variant="outlined" sx={{ py: 0 }}>
              The <b>pct</b> input is calc-bound — the wired calc-value subgraph drives every policy's
              markup % at run time (the literal below is the structural fallback).
            </Alert>
          )}
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', flex: 1 }}>
              Markup policies (per jurisdiction)
            </Typography>
            <Button size="small" startIcon={<AddIcon />}
              onClick={() => set({ markup_policies: [...markups, { jurisdiction: '', regime: 'Benchmarked', markup_pct: '', benchmark_study_ref: '' }] })}>
              Add
            </Button>
          </Stack>
          {markups.length === 0 && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Each beneficiary jurisdiction needs a policy — a missing markup BLOCKS at Stage 5 (V-M1).
            </Typography>
          )}
          {markups.map((m, i) => {
            const patchMp = (p: Partial<AuthoredMarkupPolicy>) =>
              set({ markup_policies: markups.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              <Stack key={i} spacing={0.5} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
                <Stack direction="row" spacing={0.5}>
                  <TextField size="small" label="Jurisdiction" value={m.jurisdiction} sx={{ flex: 1 }}
                    onChange={(e) => patchMp({ jurisdiction: e.target.value })} />
                  <TextField size="small" label="Markup % (0–1)" value={m.markup_pct} sx={{ width: 120 }}
                    onChange={(e) => patchMp({ markup_pct: e.target.value })} />
                  <IconButton size="small" onClick={() => set({ markup_policies: markups.filter((_, j) => j !== i) })}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
                <TextField size="small" label="Regime" value={m.regime}
                  onChange={(e) => patchMp({ regime: e.target.value })} />
                <TextField size="small" label="Benchmark study (optional)" value={m.benchmark_study_ref ?? ''}
                  onChange={(e) => patchMp({ benchmark_study_ref: e.target.value })} />
              </Stack>
            );
          })}
        </>
      )}

      {/* ---- charge / recon: no config ---- */}
      {(kind === 'charge' || kind === 'recon') && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {kind === 'charge'
            ? 'Prices the cost base + markup and charges out to recipients. No config — wired after the markup stage.'
            : 'Reconciles each pool to zero unallocated residual (V-X1). The pipeline terminal — no config.'}
        </Typography>
      )}

      {/* ---- painted per-stage result (after Run) ---- */}
      {sv && (
        <>
          <Divider />
          <Box>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>Result at this stage</Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'primary.main' }}>
              {stageResultText(kind, sv) ?? '—'}
            </Typography>
            {kind === 'recon' && (
              <Chip size="small" sx={{ mt: 0.5, height: 20 }}
                color={sv.balanced ? 'success' : 'error'}
                label={sv.balanced ? 'Balanced · zero residual' : 'Break'} />
            )}
          </Box>
        </>
      )}
    </Stack>
  );
}
