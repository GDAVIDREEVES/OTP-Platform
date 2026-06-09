import { useEffect, useMemo, useState } from 'react';
import type { FC } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Drawer,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import { api } from '@/shared/api/client';
import { useReference } from '@/kernel/data/useReference';
import type { JournalEntryRow, ReconRow, Reconciliation } from '@/shared/api/types';
import { formatCurrency } from '@/shared/utils/format';
import { tokens } from '@/shared/theme';
import KpiStrip from '@/kernel/shell/KpiStrip';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

/** OTP-18 — customs revaluation reconciliation. Takes each planned intercompany
 *  goods price (the same supply_chain ↔ TP price book, by AWREF, that OTP-43
 *  reconciles to the GL) and ties it to the value the importer actually declared
 *  to customs. Where the declared value diverges from the arm's-length TP price,
 *  the duty was paid on the wrong base — an over/under-payment exposure. Mirrors
 *  the OTP-43 recon grid: answer-first KPI strip, exceptions-first break list, and
 *  a drill into the underlying ACDOCA postings. The dutiable base and entity pairs
 *  come from /api/reconciliation; the duty rates + declared-value basis come from
 *  the fabricated /api/reference/customs seed — no figures are hardcoded here. */

// ── Reference seed shape (finance/customs.v1.json) ───────────────────────────
interface DutyRate {
  jurisdiction: string;
  material_type: string;
  duty_rate: number;
}
interface ValueBasis {
  importer: string;
  jurisdiction: string;
  jurisdiction_name: string;
  basis: string;
  note: string;
}
interface CustomsSeed {
  fabricated?: boolean;
  note?: string;
  materiality_pct: number;
  dutiable_material_types: string[];
  value_basis: ValueBasis[];
  duty_rates: DutyRate[];
  default_duty_rate: number;
  declared_value_adjustment: {
    by_material_type: Record<string, number>;
  };
}

// ── Derived customs line: one dutiable goods import vs its declared value ─────
type DutyStatus = 'reconciled' | 'duty-break' | 'no-basis';
interface CustomsLine {
  awref: string;
  seller: string;
  buyer: string;
  sellerName: string;
  buyerName: string;
  materialType: string;
  jurisdiction: string;
  jurisdictionName: string;
  basis: string; // first-sale | last-sale | —
  planned: number; // arm's-length TP price (dutiable-base reference)
  declared: number; // value entered at customs
  dutyRate: number; // %
  dutyOnDeclared: number;
  dutyOnPlanned: number;
  dutyDelta: number; // dutyOnDeclared − dutyOnPlanned (over/under-payment)
  valueDelta: number; // declared − planned
  status: DutyStatus;
}

const STATUS_META: Record<DutyStatus, { label: string; color: string }> = {
  reconciled: { label: 'Reconciled', color: tokens.ok },
  'duty-break': { label: 'Duty break', color: tokens.risk },
  'no-basis': { label: 'No basis', color: tokens.watch },
};

const RANK: Record<DutyStatus, number> = { 'duty-break': 0, 'no-basis': 1, reconciled: 2 };
const exceptionsFirst = (rows: CustomsLine[]) =>
  [...rows].sort(
    (a, b) => RANK[a.status] - RANK[b.status] || Math.abs(b.dutyDelta) - Math.abs(a.dutyDelta) || b.planned - a.planned,
  );
const isBreak = (r: CustomsLine) => r.status !== 'reconciled';
const fmtDelta = (v: number, currency = 'USD') =>
  v === 0 ? '0' : `${v > 0 ? '+' : ''}${formatCurrency(v, currency)}`;

function StatusChip({ status }: { status: DutyStatus }) {
  const m = STATUS_META[status];
  return <Chip size="small" label={m.label} sx={{ bgcolor: m.color, color: 'white', fontWeight: 700, height: 22 }} />;
}

/** Alive-guarded fetch of the shared reconciliation source (planned TP price book). */
function useReconciliation() {
  const [data, setData] = useState<Reconciliation | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .reconciliation()
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  return { data, loading };
}

/** Join the planned TP price book to the customs duty-rate + value-basis seed.
 *  Importer (the buyer) drives the import jurisdiction and the declared-value
 *  basis; the declared value is modelled from the planned price via the seed's
 *  per-material divergence factor. Only physical-goods legs are dutiable. */
function useCustomsLines() {
  const { data, loading: rLoading } = useReconciliation();
  const { data: seed, loading: sLoading } = useReference<CustomsSeed>('customs');

  const lines = useMemo<CustomsLine[]>(() => {
    if (!data || !seed) return [];
    const dutiable = new Set(seed.dutiable_material_types);
    const basisByImporter = new Map(seed.value_basis.map((v) => [v.importer, v]));
    const rateBy = new Map(seed.duty_rates.map((d) => [`${d.jurisdiction}|${d.material_type}`, d.duty_rate]));
    const adj = seed.declared_value_adjustment.by_material_type;

    const out: CustomsLine[] = [];
    for (const r of data.rows as ReconRow[]) {
      if (!dutiable.has(r.materialType)) continue;
      const vb = basisByImporter.get(r.buyer);
      const jurisdiction = vb?.jurisdiction ?? '—';
      const dutyRate = vb ? rateBy.get(`${jurisdiction}|${r.materialType}`) ?? seed.default_duty_rate : 0;
      const factor = adj[r.materialType] ?? 1.0;
      const declared = vb ? Math.round(r.planned * factor) : 0;
      const dutyOnDeclared = Math.round((declared * dutyRate) / 100);
      const dutyOnPlanned = Math.round((r.planned * dutyRate) / 100);
      const dutyDelta = dutyOnDeclared - dutyOnPlanned;
      const valueDelta = declared - r.planned;
      const materialPct = r.planned > 0 ? Math.abs(valueDelta) / r.planned * 100 : 0;

      let status: DutyStatus;
      if (!vb) status = 'no-basis';
      else if (materialPct >= seed.materiality_pct) status = 'duty-break';
      else status = 'reconciled';

      out.push({
        awref: r.awref,
        seller: r.seller,
        buyer: r.buyer,
        sellerName: r.sellerName,
        buyerName: r.buyerName,
        materialType: r.materialType,
        jurisdiction,
        jurisdictionName: vb?.jurisdiction_name ?? '—',
        basis: vb?.basis ?? '—',
        planned: r.planned,
        declared,
        dutyRate,
        dutyOnDeclared,
        dutyOnPlanned,
        dutyDelta,
        valueDelta,
        status,
      });
    }
    return out;
  }, [data, seed]);

  const summary = useMemo(() => {
    const dutiableBase = lines.reduce((s, l) => s + l.declared, 0);
    const dutyExposure = lines.reduce((s, l) => s + l.dutyOnDeclared, 0);
    const breaks = lines.filter((l) => l.status === 'duty-break').length;
    const noBasis = lines.filter((l) => l.status === 'no-basis').length;
    const dutyDelta = lines.reduce((s, l) => s + l.dutyDelta, 0);
    return { lines: lines.length, dutiableBase, dutyExposure, breaks, noBasis, dutyDelta };
  }, [lines]);

  return { lines, summary, seed, loading: rLoading || sLoading };
}

const FabricatedNote: FC = () => (
  <Alert severity="warning" variant="outlined">
    <b>Fabricated data — illustrative.</b> The ad-valorem duty rates and the per-importer declared-value basis
    (first-sale vs last-sale) come from a seeded customs reference, not the warehouse — they are publicly checkable
    against the live tariff schedules (EU TARIC, UK Global Tariff, India Customs Tariff) and should be confirmed there.
    The dutiable base they are applied to is real: the planned arm's-length TP price by AWREF.
  </Alert>
);

const Kpis: FC<BindingCtx> = () => {
  const { summary, loading } = useCustomsLines();
  const has = !loading && summary.lines > 0;
  const items: KpiItem[] = [
    { key: 'lines', label: 'Dutiable lines', value: has ? String(summary.lines) : '—', provenance: 'supply_chain (goods legs) × customs' },
    { key: 'base', label: 'Declared dutiable base', value: has ? formatCurrency(summary.dutiableBase, 'USD', true) : '—' },
    { key: 'duty', label: 'Duty exposure', value: has ? formatCurrency(summary.dutyExposure, 'USD', true) : '—', hint: 'duty on declared value' },
    { key: 'brk', label: 'Duty breaks', value: has ? String(summary.breaks) : '—', tone: has && summary.breaks > 0 ? 'risk' : 'ok', hint: 'declared value ≠ TP price' },
  ];
  return <KpiStrip items={items} />;
};

/** Drill into the ACDOCA postings behind one customs line (by AWREF) — the same
 *  posting evidence OTP-43 uses, so the duty base is traceable to the GL. */
function PostingsDrawer({ row, onClose }: { row: CustomsLine | null; onClose: () => void }) {
  const [rows, setRows] = useState<JournalEntryRow[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!row) return;
    let alive = true;
    setLoading(true);
    api
      .journalEntries({ awref: row.awref, limit: 200 })
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [row]);

  return (
    <Drawer anchor="right" open={!!row} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 660 } } }}>
      {row && (
        <Box sx={{ p: 2 }}>
          <Stack direction="row" alignItems="flex-start" sx={{ mb: 1.5 }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                Drill to source · ACDOCA postings · {row.awref}
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                {row.sellerName} → {row.buyerName}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} alignItems="center">
                <StatusChip status={row.status} />
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Import to {row.jurisdictionName} · {row.basis} · duty {row.dutyRate}% · {row.materialType}
                </Typography>
              </Stack>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                TP price {formatCurrency(row.planned, 'USD')} · Declared {formatCurrency(row.declared, 'USD')} ·
                {' '}Value Δ {fmtDelta(row.valueDelta)} · Duty Δ {fmtDelta(row.dutyDelta)}
              </Typography>
            </Box>
            <IconButton onClick={onClose} aria-label="Close">
              <CloseIcon />
            </IconButton>
          </Stack>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Doc</TableCell>
                  <TableCell>Account</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell align="right">Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.BELNR}-${r.DOCLN}-${i}`} hover>
                    <TableCell>{r.BUDAT ?? '—'}</TableCell>
                    <TableCell>{r.BELNR}</TableCell>
                    <TableCell>{r.RACCT}</TableCell>
                    <TableCell sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.SGTXT}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.HSL, r.RHCUR || 'USD')}</TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography variant="body2" sx={{ color: 'text.secondary', py: 2, textAlign: 'center' }}>
                        No ACDOCA postings found for this reference.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </Box>
      )}
    </Drawer>
  );
}

const Overview: FC<BindingCtx> = () => {
  const { lines, summary, loading } = useCustomsLines();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  const breaks = exceptionsFirst(lines.filter(isBreak));
  return (
    <Stack spacing={2} sx={{ maxWidth: 900 }}>
      <FabricatedNote />
      <Typography variant="body1">
        Every dutiable intercompany goods import (<b>{summary.lines}</b> goods legs by AWREF) is revalued against the
        arm's-length TP price it should have been declared at. The declared dutiable base is{' '}
        <b>{formatCurrency(summary.dutiableBase, 'USD', true)}</b> carrying{' '}
        <b>{formatCurrency(summary.dutyExposure, 'USD', true)}</b> of duty; <b>{summary.breaks}</b> lines declared at a
        value that breaks the TP price (net duty exposure <b>{fmtDelta(summary.dutyDelta)}</b>), and{' '}
        <b>{summary.noBasis}</b> have no value-basis on file. This is detection — each break is the entry point to a
        posting drill.
      </Typography>
      {breaks.length > 0 ? (
        <Box>
          <Typography variant="overline" sx={{ color: 'text.secondary' }}>Duty breaks this period</Typography>
          {breaks.slice(0, 12).map((r) => (
            <Stack key={r.awref} direction="row" alignItems="center" spacing={1.5} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
              <StatusChip status={r.status} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {r.sellerName} → {r.buyerName}{' '}
                  <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>· {r.materialType} · import to {r.jurisdictionName} · {r.basis} · {r.awref}</Typography>
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  TP {formatCurrency(r.planned, 'USD')} · Declared {formatCurrency(r.declared, 'USD')} · Value Δ {fmtDelta(r.valueDelta)} · Duty {r.dutyRate}% · Duty Δ {fmtDelta(r.dutyDelta)}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Box>
      ) : (
        <Alert severity="success" variant="outlined">Every dutiable goods import was declared at its arm's-length TP price.</Alert>
      )}
    </Stack>
  );
};

const Worklist: FC<BindingCtx> = () => {
  const { lines, loading } = useCustomsLines();
  const sorted = useMemo(() => exceptionsFirst(lines), [lines]);
  const [drill, setDrill] = useState<CustomsLine | null>(null);
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  return (
    <Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Status</TableCell>
            <TableCell>Reference</TableCell>
            <TableCell>Entity pair</TableCell>
            <TableCell>Import / basis</TableCell>
            <TableCell align="right">TP price</TableCell>
            <TableCell align="right">Declared</TableCell>
            <TableCell align="right">Duty %</TableCell>
            <TableCell align="right">Duty Δ</TableCell>
            <TableCell align="right">Source</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((r) => (
            <TableRow key={r.awref} hover sx={isBreak(r) ? { bgcolor: '#FEF7ED' } : undefined}>
              <TableCell><StatusChip status={r.status} /></TableCell>
              <TableCell sx={{ fontFamily: 'monospace' }}>{r.awref}</TableCell>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{r.sellerName} → {r.buyerName}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{r.seller} → {r.buyer} · {r.materialType}</Typography>
              </TableCell>
              <TableCell>
                <Typography variant="body2">{r.jurisdictionName}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{r.basis}</Typography>
              </TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.planned, 'USD')}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.declared, 'USD')}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.dutyRate}%</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.dutyDelta !== 0 ? tokens.risk : 'inherit', fontWeight: r.dutyDelta !== 0 ? 700 : 400 }}>
                {fmtDelta(r.dutyDelta)}
              </TableCell>
              <TableCell align="right">
                <Tooltip title="Drill to ACDOCA postings" arrow>
                  <IconButton size="small" onClick={() => setDrill(r)} aria-label={`Drill ${r.awref}`}>
                    <TravelExploreIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <PostingsDrawer row={drill} onClose={() => setDrill(null)} />
    </Box>
  );
};

export const otp18: ProcessBinding = {
  kpis: Kpis,
  tabs: { overview: Overview, worklist: Worklist },
};
