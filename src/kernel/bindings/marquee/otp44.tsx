import { useEffect, useState } from 'react';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import { useEntities } from '@/shared/providers/DataProvider';
import type { Entity } from '@/shared/types/entity';
import KpiStrip from '@/kernel/shell/KpiStrip';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import { useReference } from '@/kernel/data/useReference';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import type { ProfitSplitKey, ProfitSplitModel } from '@/shared/api/types';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

const KEY_LABEL: Record<ProfitSplitKey, string> = { opex_rd: 'R&D', sga: 'SG&A' };
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** One per-entity DEMPE allocation line (mirrors OTP-29's substance ledger). */
interface DempeAlloc {
  intangible_id: string;
  rbukrs: string;
  develop: number;
  enhance: number;
  maintain: number;
  protect: number;
  exploit: number;
  fte: number;
}

const nameOf = (entities: Entity[], code: string) => entities.find((e) => e.id === code)?.name ?? code;

/** Roll the per-intangible DEMPE lines up to a per-entity substance weight: total
 *  DEMPE-function points and FTE across every intangible the entity contributes to. */
function dempeByEntity(allocs: DempeAlloc[]) {
  const byEntity = new Map<string, { rbukrs: string; points: number; fte: number }>();
  for (const a of allocs) {
    const points = a.develop + a.enhance + a.maintain + a.protect + a.exploit;
    const cur = byEntity.get(a.rbukrs) ?? { rbukrs: a.rbukrs, points: 0, fte: 0 };
    cur.points += points;
    cur.fte += a.fte;
    byEntity.set(a.rbukrs, cur);
  }
  const rows = Array.from(byEntity.values());
  const totalPoints = rows.reduce((s, r) => s + r.points, 0) || 1;
  const totalFte = rows.reduce((s, r) => s + r.fte, 0) || 1;
  return rows
    .map((r) => ({ ...r, pointShare: r.points / totalPoints, fteShare: r.fte / totalFte }))
    .sort((a, b) => b.points - a.points);
}

/** Alive-guarded fetch of the reconciled profit-split model (live from segment_pl). */
function useProfitSplit(key: ProfitSplitKey) {
  const [model, setModel] = useState<ProfitSplitModel | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .profitSplit({ key })
      .then((m) => alive && setModel(m))
      .catch(() => alive && setModel(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [key]);
  return { model, loading };
}

const Kpis: FC<BindingCtx> = () => {
  const { model } = useProfitSplit('opex_rd');
  const items: KpiItem[] = [
    { key: 'combined', label: 'Combined residual profit', value: model ? formatCurrency(model.combined_profit, 'USD', true) : '—', provenance: 'segment_pl · operating_profit' },
    { key: 'parties', label: 'Non-routine parties', value: model ? String(model.participants.length) : '—' },
    { key: 'key', label: 'Default key', value: model ? KEY_LABEL[model.default_key] : '—', hint: 'R&D value-driver' },
  ];
  return <KpiStrip items={items} />;
};

const SplitTable: FC<{ model: ProfitSplitModel }> = ({ model }) => (
  <Table size="small">
    <TableHead>
      <TableRow>
        <TableCell>Participant</TableCell>
        <TableCell align="right">Key value</TableCell>
        <TableCell align="right">Residual share</TableCell>
        <TableCell align="right">Allocated profit</TableCell>
      </TableRow>
    </TableHead>
    <TableBody>
      {model.participants.map((p) => (
        <TableRow key={p.rbukrs} hover>
          <TableCell sx={{ fontWeight: 700 }}>{p.name}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(p.key_value, 'USD', true)}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{pct(p.residual_share)}</TableCell>
          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(p.allocated_profit, 'USD', true)}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

/** OTP-29 DEMPE substance basis: the per-entity DEMPE-function / FTE weighting
 *  the allocation key is meant to track. Read-only; the figures are the dempe
 *  seed (same source as OTP-29), surfaced here so the key choice is defensible. */
const DempeBasis: FC = () => {
  const navigate = useNavigate();
  const entities = useEntities();
  const { data, loading } = useReference<{ allocations: DempeAlloc[] }>('dempe');
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={22} /></Box>;
  const rows = dempeByEntity(data?.allocations ?? []);
  if (!rows.length) return null;
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>DEMPE basis</Typography>
        <ProvenanceChip
          source="OTP-29 DEMPE"
          tooltip="Per-entity DEMPE substance from the OTP-29 ledger — the allocation key should track this"
          onClick={() => navigate('/process/OTP-29/overview')}
        />
      </Stack>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        The allocation key should track DEMPE substance: entities performing the Develop / Enhance / Maintain /
        Protect / Exploit functions, weighted by people, are the ones that should earn the residual.
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Entity</TableCell>
            <TableCell align="right">DEMPE points</TableCell>
            <TableCell align="right">Substance share</TableCell>
            <TableCell align="right">FTE</TableCell>
            <TableCell align="right">FTE share</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.rbukrs} hover>
              <TableCell sx={{ fontWeight: 700 }}>{nameOf(entities, r.rbukrs)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.points}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{pct(r.pointShare)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.fte}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{pct(r.fteShare)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  );
};

const Workpaper: FC<BindingCtx> = () => {
  const user = useSessionUser();
  const [key, setKey] = useState<ProfitSplitKey>('opex_rd');
  const { model, loading } = useProfitSplit(key);

  // Changing the allocation key is a design decision made against DEMPE substance
  // — log it as a handoff from OTP-29 so it lands on the audit chain / lineage feed.
  const changeKey = (next: ProfitSplitKey) => {
    setKey(next);
    void api
      .recordHandoff({
        record_ref: 'OTP44-profit-split-design',
        from_process: 'OTP-29',
        to_process: 'OTP-44',
        actor: user.id,
        summary: 'Allocation key aligned to DEMPE substance',
      })
      .catch(() => undefined);
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.participants.length) {
    return <Alert severity="info" variant="outlined">No profit-split participants for the period.</Alert>;
  }
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        Residual profit-split design: the {formatCurrency(model.combined_profit, 'USD', true)} combined operating profit of
        the non-routine parties is allocated by a value-driver key. Each participant&rsquo;s share is its key value over the
        group total. Figures are live from segment_pl.
      </Alert>
      <Box>
        <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'text.secondary' }}>Allocation key</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={key}
          onChange={(_, v) => v && changeKey(v as ProfitSplitKey)}
        >
          {model.keys.map((k) => (
            <ToggleButton key={k} value={k}>{KEY_LABEL[k]}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>
      <SplitTable model={model} />
      <DempeBasis />
    </Stack>
  );
};

export const otp44: ProcessBinding = { kpis: Kpis, tabs: { overview: Workpaper, calculation: Workpaper } };
