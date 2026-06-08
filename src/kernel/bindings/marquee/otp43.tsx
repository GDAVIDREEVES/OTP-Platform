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
import type { JournalEntryRow, ReconRow, Reconciliation, ReconStatus } from '@/shared/api/types';
import { formatCurrency } from '@/shared/utils/format';
import { tokens } from '@/shared/theme';
import KpiStrip from '@/kernel/shell/KpiStrip';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

/** OTP-43 — ERP ↔ TP reconciliation. Ties each planned intercompany flow
 *  (supply_chain, keyed by AWREF, with TP method + entity pair) to what actually
 *  posted in ACDOCA (journal HSL by AWREF), and classifies the gap. Mirrors the
 *  OTP-20 monitoring layout: an answer-first KPI strip, an exceptions-first break
 *  list, and a drill into the underlying postings. Every figure comes from
 *  /api/reconciliation — nothing is hardcoded. */

const STATUS_META: Record<ReconStatus, { label: string; color: string; tone: 'ok' | 'watch' | 'risk' }> = {
  reconciled: { label: 'Reconciled', color: tokens.ok, tone: 'ok' },
  unposted: { label: 'Unposted', color: tokens.watch, tone: 'watch' },
  'value-break': { label: 'Value break', color: tokens.risk, tone: 'risk' },
  challenged: { label: 'Challenged', color: tokens.risk, tone: 'risk' },
};

// Exceptions first: value breaks and challenges before unposted, reconciled last.
const RANK: Record<ReconStatus, number> = { 'value-break': 0, challenged: 1, unposted: 2, reconciled: 3 };
const exceptionsFirst = (rows: ReconRow[]) =>
  [...rows].sort((a, b) => RANK[a.status] - RANK[b.status] || Math.abs(b.delta) - Math.abs(a.delta) || b.planned - a.planned);

const isBreak = (r: ReconRow) => r.status !== 'reconciled';
const fmtDelta = (r: ReconRow) =>
  r.posted == null ? '—' : r.delta === 0 ? '0' : `${r.delta > 0 ? '+' : ''}${formatCurrency(r.delta, 'USD')}`;

/** Alive-guarded fetch of the shared reconciliation source. */
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

const Kpis: FC<BindingCtx> = () => {
  const { data } = useReconciliation();
  const s = data?.summary;
  const items: KpiItem[] = [
    { key: 'rec', label: 'Reconciled', value: s ? `${s.reconciled}/${s.total}` : '—', tone: 'ok', provenance: 'supply_chain ↔ ACDOCA · AWREF' },
    { key: 'unp', label: 'Unposted', value: s ? String(s.unposted) : '—', tone: s && s.unposted > 0 ? 'watch' : 'ok', hint: 'planned, not yet in the GL' },
    { key: 'vb', label: 'Value breaks', value: s ? String(s['value-breaks']) : '—', tone: s && s['value-breaks'] > 0 ? 'risk' : 'ok', hint: 'posted ≠ planned price' },
    { key: 'ch', label: 'Challenged', value: s ? String(s.challenged) : '—', tone: s && s.challenged > 0 ? 'risk' : 'ok', hint: 'under authority / internal query' },
  ];
  return <KpiStrip items={items} />;
};

function StatusChip({ status }: { status: ReconStatus }) {
  const m = STATUS_META[status];
  return <Chip size="small" label={m.label} sx={{ bgcolor: m.color, color: 'white', fontWeight: 700, height: 22 }} />;
}

/** Drill into the ACDOCA postings behind one reconciled/broken flow (by AWREF). */
function PostingsDrawer({ row, onClose }: { row: ReconRow | null; onClose: () => void }) {
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
                  Planned {formatCurrency(row.planned, 'USD')} · Posted {row.posted == null ? '—' : formatCurrency(row.posted, 'USD')} · Δ {fmtDelta(row)}
                </Typography>
              </Stack>
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
                        {row.status === 'unposted'
                          ? 'No ACDOCA postings yet — this planned flow has not been billed to the GL.'
                          : 'No postings found for this reference.'}
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
  const { data, loading } = useReconciliation();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  const s = data?.summary;
  const breaks = exceptionsFirst((data?.rows ?? []).filter(isBreak));
  return (
    <Stack spacing={2} sx={{ maxWidth: 900 }}>
      <Typography variant="body1">
        Every intercompany flow priced in TP (<b>{s?.total ?? 0}</b> by AWREF) is tied to what actually posted in
        ACDOCA. <b>{s?.reconciled ?? 0}</b> reconcile cleanly; <b>{s?.unposted ?? 0}</b> are planned but unposted,{' '}
        <b>{s?.['value-breaks'] ?? 0}</b> posted at a value that breaks the TP price, and <b>{s?.challenged ?? 0}</b> are
        under challenge. This is detection — each break is the entry point to a posting drill.
      </Typography>
      {breaks.length > 0 ? (
        <Box>
          <Typography variant="overline" sx={{ color: 'text.secondary' }}>Breaks this period</Typography>
          {breaks.slice(0, 12).map((r) => (
            <Stack key={r.awref} direction="row" alignItems="center" spacing={1.5} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
              <StatusChip status={r.status} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {r.sellerName} → {r.buyerName}{' '}
                  <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>· {r.tpMethod} · {r.awref}</Typography>
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Planned {formatCurrency(r.planned, 'USD')} · Posted {r.posted == null ? '—' : formatCurrency(r.posted, 'USD')} · Δ {fmtDelta(r)}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Box>
      ) : (
        <Alert severity="success" variant="outlined">All priced intercompany flows reconcile to their ACDOCA postings.</Alert>
      )}
    </Stack>
  );
};

const Worklist: FC<BindingCtx> = () => {
  const { data, loading } = useReconciliation();
  const sorted = useMemo(() => exceptionsFirst(data?.rows ?? []), [data]);
  const [drill, setDrill] = useState<ReconRow | null>(null);
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  return (
    <Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Status</TableCell>
            <TableCell>Reference</TableCell>
            <TableCell>Entity pair</TableCell>
            <TableCell>TP method</TableCell>
            <TableCell align="right">Planned</TableCell>
            <TableCell align="right">Posted</TableCell>
            <TableCell align="right">Delta</TableCell>
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
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{r.seller} → {r.buyer}</Typography>
              </TableCell>
              <TableCell>{r.tpMethod}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.planned, 'USD')}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.posted == null ? '—' : formatCurrency(r.posted, 'USD')}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.delta !== 0 ? tokens.risk : 'inherit', fontWeight: r.delta !== 0 ? 700 : 400 }}>
                {fmtDelta(r)}
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

export const otp43: ProcessBinding = {
  kpis: Kpis,
  tabs: { overview: Overview, worklist: Worklist },
};
