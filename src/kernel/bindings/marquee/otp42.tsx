import { useEffect, useMemo, useState } from 'react';
import type { FC } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import type { ReconRow, Reconciliation } from '@/shared/api/types';
import { formatCurrency } from '@/shared/utils/format';
import { tokens } from '@/shared/theme';
import KpiStrip from '@/kernel/shell/KpiStrip';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

/** OTP-42 — IC billing automation & controls. REUSES the OTP-43
 *  /api/reconciliation source (planned supply_chain price vs posted ACDOCA
 *  value, by AWREF) and re-frames each flow as a billing state:
 *
 *    billed       ← reconciled  (invoice posted at the TP price — done)
 *    due to bill   ← unposted    (priced flow with no posting — invoice still to raise)
 *    blocked       ← value-break / challenged (posted≠planned or under challenge —
 *                                  the control gate holds the invoice for review)
 *
 *  Same exceptions-queue layout as OTP-20; the blocked queue is the work. Because
 *  it shares OTP-43's source, the two screens can never disagree about a flow. */

type BillState = 'billed' | 'due-to-bill' | 'blocked';

const STATE_META: Record<BillState, { label: string; color: string }> = {
  billed: { label: 'Billed', color: tokens.ok },
  'due-to-bill': { label: 'Due to bill', color: tokens.watch },
  blocked: { label: 'Blocked', color: tokens.risk },
};

function billState(r: ReconRow): BillState {
  if (r.status === 'reconciled') return 'billed';
  if (r.status === 'unposted') return 'due-to-bill';
  return 'blocked'; // value-break | challenged
}

/** Why a blocked flow can't auto-bill — the control that fired. */
function blockReason(r: ReconRow): string {
  if (r.status === 'challenged') return 'Under challenge — billing held pending resolution';
  if (r.status === 'value-break')
    return `Posted ${r.posted == null ? '—' : formatCurrency(r.posted, 'USD')} ≠ planned ${formatCurrency(r.planned, 'USD')} (Δ ${formatCurrency(r.delta, 'USD')})`;
  return '';
}

// Exceptions first: blocked, then due-to-bill, billed last.
const RANK: Record<BillState, number> = { blocked: 0, 'due-to-bill': 1, billed: 2 };
const queueOrder = (rows: ReconRow[]) =>
  [...rows].sort((a, b) => RANK[billState(a)] - RANK[billState(b)] || b.planned - a.planned);

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

/** Roll the four recon statuses up into the three billing states + their value. */
function useBilling() {
  const { data, loading } = useReconciliation();
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const counts = useMemo(() => {
    const c = { billed: 0, 'due-to-bill': 0, blocked: 0 } as Record<BillState, number>;
    const v = { billed: 0, 'due-to-bill': 0, blocked: 0 } as Record<BillState, number>;
    for (const r of rows) {
      const st = billState(r);
      c[st] += 1;
      v[st] += r.planned;
    }
    return { c, v, total: rows.length };
  }, [rows]);
  return { rows, counts, loading };
}

const Kpis: FC<BindingCtx> = () => {
  const { counts } = useBilling();
  const { c, v, total } = counts;
  const items: KpiItem[] = [
    { key: 'tot', label: 'IC invoices', value: String(total), provenance: 'supply_chain ↔ ACDOCA · AWREF' },
    { key: 'bil', label: 'Billed', value: total ? `${c.billed}/${total}` : '—', tone: 'ok', hint: formatCurrency(v.billed, 'USD', true) },
    { key: 'due', label: 'Due to bill', value: String(c['due-to-bill']), tone: c['due-to-bill'] > 0 ? 'watch' : 'ok', hint: formatCurrency(v['due-to-bill'], 'USD', true) },
    { key: 'blk', label: 'Blocked', value: String(c.blocked), tone: c.blocked > 0 ? 'risk' : 'ok', hint: 'control gate held' },
  ];
  return <KpiStrip items={items} />;
};

function StateChip({ state }: { state: BillState }) {
  const m = STATE_META[state];
  return <Chip size="small" label={m.label} sx={{ bgcolor: m.color, color: 'white', fontWeight: 700, height: 22 }} />;
}

const Overview: FC<BindingCtx> = () => {
  const { rows, counts, loading } = useBilling();
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  const { c } = counts;
  const blocked = queueOrder(rows.filter((r) => billState(r) === 'blocked'));
  return (
    <Stack spacing={2} sx={{ maxWidth: 900 }}>
      <Typography variant="body1">
        Intercompany billing runs straight-through where the posting matches the TP price: <b>{c.billed}</b> invoices are
        billed and <b>{c['due-to-bill']}</b> are priced and due to bill. <b>{c.blocked}</b> are <b>blocked</b> by a control
        — a posted value that breaks the price, or a flow under challenge — and must clear review before they invoice.
      </Typography>
      {blocked.length > 0 ? (
        <Box>
          <Typography variant="overline" sx={{ color: 'text.secondary' }}>Blocked — control exceptions</Typography>
          {blocked.map((r) => (
            <Stack key={r.awref} direction="row" alignItems="center" spacing={1.5} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
              <StateChip state="blocked" />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {r.sellerName} → {r.buyerName}{' '}
                  <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>· {r.tpMethod} · {r.awref}</Typography>
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{blockReason(r)}</Typography>
              </Box>
            </Stack>
          ))}
        </Box>
      ) : (
        <Alert severity="success" variant="outlined">No blocked invoices — every priced flow either billed cleanly or is simply awaiting its posting run.</Alert>
      )}
    </Stack>
  );
};

const Worklist: FC<BindingCtx> = () => {
  const { rows, loading } = useBilling();
  const sorted = useMemo(() => queueOrder(rows), [rows]);
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Billing state</TableCell>
          <TableCell>Reference</TableCell>
          <TableCell>Entity pair</TableCell>
          <TableCell>TP method</TableCell>
          <TableCell align="right">Amount</TableCell>
          <TableCell>Control note</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {sorted.map((r) => {
          const st = billState(r);
          return (
            <TableRow key={r.awref} hover sx={st === 'blocked' ? { bgcolor: '#FEF2F2' } : undefined}>
              <TableCell><StateChip state={st} /></TableCell>
              <TableCell sx={{ fontFamily: 'monospace' }}>{r.awref}</TableCell>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{r.sellerName} → {r.buyerName}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{r.seller} → {r.buyer}</Typography>
              </TableCell>
              <TableCell>{r.tpMethod}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.planned, 'USD')}</TableCell>
              <TableCell sx={{ maxWidth: 320, color: st === 'blocked' ? tokens.risk : 'text.secondary', fontWeight: st === 'blocked' ? 600 : 400 }}>
                {st === 'blocked' ? blockReason(r) : st === 'due-to-bill' ? 'Awaiting posting run' : 'Posted at TP price'}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

export const otp42: ProcessBinding = {
  kpis: Kpis,
  tabs: { overview: Overview, worklist: Worklist },
};
