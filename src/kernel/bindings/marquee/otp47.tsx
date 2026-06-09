import { useEffect, useState } from 'react';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import type { TreasuryModel } from '@/shared/api/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import { useReference } from '@/kernel/data/useReference';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

/** One FX/hedging position from the fabricated `fx` reference seed. */
interface FxPosition {
  currency: string;
  label: string;
  entity: string;
  entity_name: string;
  exposure_source: string;
  ic_exposure_local: number;
  spot_rate: number;
  forward_rate: number;
  hedge_ratio_pct: number;
  hedge_instrument: string;
}
interface FxModel {
  fabricated: boolean;
  base_currency: string;
  as_of: string;
  min_hedge_policy_pct: number;
  positions: FxPosition[];
}

/** Per-position derived FX measures — every figure computed from the seed, none hardcoded. */
interface FxRow extends FxPosition {
  exposureUsd: number;
  hedgedUsd: number;
  unhedgedUsd: number;
  /** MTM on the hedged notional = hedged local x (forward - spot), in USD. */
  mtmUsd: number;
  underHedged: boolean;
}

/** EUR/CHF/GBP are quoted as USD per 1 unit of local, so USD = local x spot. */
const usd = (local: number, rate: number) => local * rate;

function derive(model: FxModel): FxRow[] {
  const floor = model.min_hedge_policy_pct;
  return model.positions.map((p) => {
    const exposureUsd = usd(p.ic_exposure_local, p.spot_rate);
    const hedgedLocal = p.ic_exposure_local * (p.hedge_ratio_pct / 100);
    const hedgedUsd = usd(hedgedLocal, p.spot_rate);
    const unhedgedUsd = exposureUsd - hedgedUsd;
    const mtmUsd = hedgedLocal * (p.forward_rate - p.spot_rate);
    return { ...p, exposureUsd, hedgedUsd, unhedgedUsd, mtmUsd, underHedged: p.hedge_ratio_pct < floor };
  });
}

const totals = (rows: FxRow[]) => {
  const exposure = rows.reduce((s, r) => s + r.exposureUsd, 0);
  const hedged = rows.reduce((s, r) => s + r.hedgedUsd, 0);
  const unhedged = rows.reduce((s, r) => s + r.unhedgedUsd, 0);
  const mtm = rows.reduce((s, r) => s + r.mtmUsd, 0);
  const hedgedPct = exposure > 0 ? Math.round((hedged / exposure) * 100) : 0;
  return { exposure, hedged, unhedged, mtm, hedgedPct };
};

/** Under-hedged first, then largest unhedged exposure first. */
const exceptionsFirst = (rows: FxRow[]) =>
  [...rows].sort((a, b) => Number(b.underHedged) - Number(a.underHedged) || b.unhedgedUsd - a.unhedgedUsd);

const fmtMtm = (v: number) => `${v >= 0 ? '+' : '−'}${formatCurrency(Math.abs(v), 'USD', true)}`;

/** Alive-guarded fetch of the treasury model — the live IC-loan/pool exposure base
 *  the fabricated FX positions are anchored to (the EUR legs tie to ICL-3000/3200). */
function useTreasury() {
  const [model, setModel] = useState<TreasuryModel | null>(null);
  useEffect(() => {
    let alive = true;
    api.treasury().then((m) => alive && setModel(m)).catch(() => alive && setModel(null));
    return () => {
      alive = false;
    };
  }, []);
  return model;
}

function useFx() {
  const { data, loading } = useReference<FxModel>('fx');
  return { model: data, loading };
}

const FabricatedNote: FC = () => (
  <Alert severity="warning" variant="outlined">
    <b>Fabricated data — illustrative.</b> The FX spot/forward rates, per-currency hedge ratios and hedge instruments
    are illustrative — there is no FX-rate or hedge source in the warehouse. The IC FX exposures are anchored to the
    fabricated treasury register: the EUR leg ties to the EUR-denominated IC loans, and the CHF/GBP legs are sized to
    be credible for the group&rsquo;s CH IP Principal and GB Distribution IC balances. Confirm the scale, rates and
    hedge coverage before relying on these figures.
  </Alert>
);

const Kpis: FC<BindingCtx> = () => {
  const { model } = useFx();
  const rows = model ? derive(model) : [];
  const t = totals(rows);
  const items: KpiItem[] = [
    { key: 'exp', label: 'Total IC FX exposure', value: model ? formatCurrency(t.exposure, 'USD', true) : '—', provenance: 'treasury · fx seed' },
    { key: 'hedged', label: 'Hedged', value: model ? `${t.hedgedPct}%` : '—', tone: model && t.hedgedPct >= model.min_hedge_policy_pct ? 'ok' : 'watch', hint: model ? `policy floor ${model.min_hedge_policy_pct}%` : undefined },
    { key: 'unh', label: 'Unhedged exposure', value: model ? formatCurrency(t.unhedged, 'USD', true) : '—', tone: t.unhedged > 0 ? 'watch' : 'ok' },
    { key: 'mtm', label: 'Net MTM', value: model ? fmtMtm(t.mtm) : '—', tone: t.mtm >= 0 ? 'ok' : 'risk', hint: 'hedge fwd vs spot' },
  ];
  return <KpiStrip items={items} />;
};

const Overview: FC<BindingCtx> = () => {
  const { model, loading } = useFx();
  const treasury = useTreasury();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.positions.length) return <Alert severity="info" variant="outlined">No IC FX positions to monitor.</Alert>;

  const rows = exceptionsFirst(derive(model));
  const t = totals(rows);
  const flagged = rows.filter((r) => r.underHedged);
  const loanPrincipal = treasury?.totals.loan_principal;

  return (
    <Stack spacing={2} sx={{ maxWidth: 880 }}>
      <FabricatedNote />
      <Typography variant="body1">
        <b>{model.positions.length}</b> IC currency positions carry <b>{formatCurrency(t.exposure, 'USD', true)}</b> of
        FX exposure, of which <b>{t.hedgedPct}%</b> is hedged ({formatCurrency(t.hedged, 'USD', true)}) leaving{' '}
        <b>{formatCurrency(t.unhedged, 'USD', true)}</b> open. Net mark-to-market on the hedged book is{' '}
        <b>{fmtMtm(t.mtm)}</b> (locked forward vs current spot). This is detection only — positions below the{' '}
        {model.min_hedge_policy_pct}% policy floor are flagged for the treasury desk to top up the hedge.
        {loanPrincipal != null && (
          <> The exposure base ties to the {formatCurrency(loanPrincipal, 'USD', true)} IC loan register.</>
        )}
      </Typography>
      {flagged.length > 0 ? (
        <Box>
          <Typography variant="overline" sx={{ color: 'text.secondary' }}>Flagged — below hedge policy</Typography>
          {flagged.map((r) => (
            <FlaggedRow key={r.currency} r={r} floor={model.min_hedge_policy_pct} />
          ))}
        </Box>
      ) : (
        <Alert severity="success" variant="outlined">
          Every IC currency position meets the {model.min_hedge_policy_pct}% hedge policy floor.
        </Alert>
      )}
    </Stack>
  );
};

function FlaggedRow({ r, floor }: { r: FxRow; floor: number }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Chip size="small" label={`${r.hedge_ratio_pct}% hedged`} sx={{ bgcolor: '#D97706', color: 'white', fontWeight: 700 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {r.label} ({r.currency}){' '}
          <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>
            · {r.entity_name} · {r.hedge_instrument}
          </Typography>
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {formatCurrency(r.unhedgedUsd, 'USD', true)} unhedged · {floor - r.hedge_ratio_pct}pp below the {floor}% floor
        </Typography>
      </Box>
    </Stack>
  );
}

const PositionTable: FC<{ model: FxModel }> = ({ model }) => {
  const navigate = useNavigate();
  const rows = exceptionsFirst(derive(model));
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Currency</TableCell>
          <TableCell>Position</TableCell>
          <TableCell align="right">IC exposure</TableCell>
          <TableCell align="right">Spot</TableCell>
          <TableCell align="right">Exposure (USD)</TableCell>
          <TableCell align="right">Hedge</TableCell>
          <TableCell align="right">Unhedged (USD)</TableCell>
          <TableCell align="right">MTM</TableCell>
          <TableCell>Coverage</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.currency} hover>
            <TableCell>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{r.currency}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{r.label}</Typography>
            </TableCell>
            <TableCell>
              <Typography variant="body2">{r.entity_name}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{r.hedge_instrument}</Typography>
            </TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.ic_exposure_local, r.currency, true)}</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.spot_rate.toFixed(4)}</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatCurrency(r.exposureUsd, 'USD', true)}</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.hedge_ratio_pct}%</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.unhedgedUsd, 'USD', true)}</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.mtmUsd >= 0 ? '#16A34A' : '#DC2626', fontWeight: 700 }}>{fmtMtm(r.mtmUsd)}</TableCell>
            <TableCell>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Chip
                  size="small"
                  label={r.underHedged ? 'Below policy' : 'In policy'}
                  sx={{ bgcolor: r.underHedged ? '#D97706' : '#16A34A', color: 'white', fontWeight: 700, height: 22 }}
                />
                <ProvenanceChip source="treasury" tooltip="Exposure base from the IC loan / cash-pool register" onClick={() => navigate('/process/OTP-6/overview')} />
              </Stack>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

const Calculation: FC<BindingCtx> = () => {
  const { model, loading } = useFx();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!model || !model.positions.length) return <Alert severity="info" variant="outlined">No IC FX positions to monitor.</Alert>;
  const t = totals(derive(model));
  return (
    <Stack spacing={2}>
      <FabricatedNote />
      <Alert severity="info" variant="outlined">
        Exposure (USD) = IC notional &times; spot. Hedged = exposure &times; hedge ratio; the residual is open to spot
        moves. MTM marks the hedged notional at the locked forward rate against current spot ({model.base_currency},
        as of {model.as_of}). Hedged <b>{t.hedgedPct}%</b> vs the <b>{model.min_hedge_policy_pct}%</b> policy floor.
      </Alert>
      <PositionTable model={model} />
    </Stack>
  );
};

export const otp47: ProcessBinding = {
  kpis: Kpis,
  tabs: { overview: Overview, calculation: Calculation },
};
