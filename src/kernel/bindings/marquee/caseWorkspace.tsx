import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FC } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
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
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import { api } from '@/shared/api/client';
import { formatCurrency } from '@/shared/utils/format';
import { tokens } from '@/shared/theme';
import type { Case } from '@/shared/api/types';
import KpiStrip from '@/kernel/shell/KpiStrip';
import CaseDrawer from '@/kernel/data/CaseDrawer';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

const DAY_MS = 86_400_000;

/** Status → chip color + human label. Color is meaning: slate=open,
 *  blue=in progress, amber=submitted (awaiting authority), green=closed. */
const STATUS: Record<Case['status'], { color: string; label: string }> = {
  open: { color: tokens.ink, label: 'Open' },
  in_progress: { color: tokens.action, label: 'In Progress' },
  submitted: { color: tokens.watch, label: 'Submitted' },
  closed: { color: tokens.ok, label: 'Closed' },
};

/** Worklist header copy, keyed by the wired process. */
const HEADER: Record<string, string> = {
  'OTP-39': 'APA lifecycle',
  'OTP-40': 'Audit defense / IDR',
  'OTP-50': 'MAP filings',
  'OTP-30': 'Restructuring / exit charges',
  'OTP-31': 'M&A integration',
};

const daysToDue = (dueAt: string | null): number | null =>
  dueAt ? (Date.parse(dueAt) - Date.now()) / DAY_MS : null;

const isOverdue = (c: Case): boolean => {
  const d = daysToDue(c.due_at);
  return d != null && d < 0 && c.status !== 'closed';
};

const isOpen = (c: Case): boolean => c.status !== 'closed';

const fmtDue = (dueAt: string | null): string => dueAt ?? '—';
const fmtExposure = (e: number | null): string => (e == null ? '—' : formatCurrency(e, 'USD', true));

/** Alive-guarded fetch of the cases for one process, with a `reload` bump so
 *  mutations (status/checklist) can re-fetch. Mirrors otp21's `useSegments`. */
function useCases(processId: string) {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .cases({ process_id: processId })
      .then((r) => alive && setCases(r))
      .catch(() => alive && setCases([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [processId, nonce]);
  return { cases, loading, reload };
}

const StatusChip: FC<{ status: Case['status'] }> = ({ status }) => {
  const s = STATUS[status];
  return <Chip size="small" label={s.label} sx={{ bgcolor: s.color, color: 'white', fontWeight: 700, height: 22 }} />;
};

const Kpis: FC<BindingCtx> = ({ def }) => {
  const { cases } = useCases(def.id);
  const open = cases.filter(isOpen).length;
  const dueSoon = cases.filter((c) => {
    const d = daysToDue(c.due_at);
    return c.status !== 'closed' && d != null && d >= 0 && d <= 30;
  }).length;
  const overdue = cases.filter(isOverdue).length;
  const exposure = cases.reduce((s, c) => s + (c.exposure ?? 0), 0);
  const items: KpiItem[] = [
    { key: 'open', label: 'Open cases', value: String(open), hint: 'active matters' },
    { key: 'due', label: 'Due ≤ 30d', value: String(dueSoon), tone: dueSoon > 0 ? 'watch' : 'ok', hint: 'approaching deadline' },
    { key: 'over', label: 'Overdue', value: String(overdue), tone: overdue > 0 ? 'risk' : 'ok', hint: 'past due date' },
    { key: 'exp', label: 'Total exposure', value: formatCurrency(exposure, 'USD', true), hint: 'at risk across cases' },
  ];
  return <KpiStrip items={items} />;
};

const urgency = (c: Case) => {
  const d = daysToDue(c.due_at);
  return d == null ? Number.POSITIVE_INFINITY : d;
};

const Overview: FC<BindingCtx> = ({ def }) => {
  const { cases } = useCases(def.id);
  const open = cases.filter(isOpen);
  const overdue = cases.filter(isOverdue).length;
  const exposure = cases.reduce((s, c) => s + (c.exposure ?? 0), 0);
  const urgent = useMemo(() => [...open].sort((a, b) => urgency(a) - urgency(b)).slice(0, 4), [open]);
  return (
    <Stack spacing={2} sx={{ maxWidth: 860 }}>
      <Typography variant="body1">
        <b>{open.length}</b> open {open.length === 1 ? 'case' : 'cases'} · <b>{overdue}</b> overdue ·{' '}
        <b>{formatCurrency(exposure, 'USD', true)}</b> exposure for this process. Each case carries its own
        status, checklist, and audit trail — open one to advance it or pull its evidence packet.
      </Typography>
      {urgent.length > 0 ? (
        <Box>
          <Typography variant="overline" sx={{ color: 'text.secondary' }}>Most urgent</Typography>
          {urgent.map((c) => (
            <Stack
              key={c.id}
              direction="row"
              alignItems="center"
              spacing={1.5}
              sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}
            >
              <StatusChip status={c.status} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{c.title}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {c.owner}
                  {c.jurisdiction ? ` · ${c.jurisdiction}` : ''} · due {fmtDue(c.due_at)}
                </Typography>
              </Box>
              <Typography
                variant="body2"
                sx={{ fontVariantNumeric: 'tabular-nums', color: isOverdue(c) ? tokens.risk : 'text.secondary', fontWeight: isOverdue(c) ? 700 : 400 }}
              >
                {fmtExposure(c.exposure)}
              </Typography>
            </Stack>
          ))}
        </Box>
      ) : (
        <Alert severity="info" variant="outlined">No open cases for this process.</Alert>
      )}
    </Stack>
  );
};

const Worklist: FC<BindingCtx> = ({ def }) => {
  const { cases, loading, reload } = useCases(def.id);
  const [drill, setDrill] = useState<Case | null>(null);
  const sorted = useMemo(
    () =>
      [...cases].sort(
        (a, b) =>
          (a.status === 'closed' ? 1 : 0) - (b.status === 'closed' ? 1 : 0) ||
          urgency(a) - urgency(b),
      ),
    [cases],
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!sorted.length) {
    return <Alert severity="info" variant="outlined">No open cases for this process.</Alert>;
  }

  return (
    <Box>
      <Typography variant="overline" sx={{ color: 'text.secondary' }}>
        {HEADER[def.id] ?? 'Cases'}
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Status</TableCell>
            <TableCell>Title</TableCell>
            <TableCell>Owner</TableCell>
            <TableCell>Jurisdiction</TableCell>
            <TableCell>Due</TableCell>
            <TableCell align="right">Exposure</TableCell>
            <TableCell align="right">Detail</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((c) => (
            <TableRow key={c.id} hover>
              <TableCell>
                <StatusChip status={c.status} />
              </TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{c.title}</TableCell>
              <TableCell>{c.owner}</TableCell>
              <TableCell>{c.jurisdiction ?? '—'}</TableCell>
              <TableCell sx={{ color: isOverdue(c) ? tokens.risk : 'inherit', fontWeight: isOverdue(c) ? 700 : 400 }}>
                {fmtDue(c.due_at)}
              </TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtExposure(c.exposure)}</TableCell>
              <TableCell align="right">
                <Tooltip title="Open case workspace" arrow>
                  <IconButton size="small" onClick={() => setDrill(c)} aria-label={`Open ${c.title}`}>
                    <TravelExploreIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <CaseDrawer open={!!drill} onClose={() => setDrill(null)} caseItem={drill} onChanged={reload} />
    </Box>
  );
};

// No `primaryAction`: the Case Workspace is display-only in the shell header —
// all real actions live in the worklist rows and the CaseDrawer.
export const caseWorkspace: ProcessBinding = {
  kpis: Kpis,
  tabs: { overview: Overview, worklist: Worklist },
};
