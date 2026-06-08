import { useEffect, useState } from 'react';
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
import GavelIcon from '@mui/icons-material/Gavel';
import { api } from '@/shared/api/client';
import { tokens } from '@/shared/theme';
import KpiStrip from '@/kernel/shell/KpiStrip';
import DocEvidenceDrawer from '@/kernel/data/DocEvidenceDrawer';
import type { DocCoveredRow, DocEntity, DocumentationRollup } from '@/shared/api/types';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

/** Shared loader for the per-entity documentation rollup. */
export function useDocumentation() {
  const [data, setData] = useState<DocumentationRollup | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .documentation()
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  return { data, loading };
}

const STATUS: Record<string, { label: string; color: string }> = {
  in_range: { label: 'In range', color: tokens.ok },
  review: { label: 'Review', color: tokens.watch },
  na: { label: 'CUP / qual.', color: '#64748B' },
};

export const rangeText = (r: DocCoveredRow): string =>
  r.lower != null ? `${r.lower}–${r.upper}${r.unit ?? ''}` : '—';

/** §6662 best-method narrative for a covered transaction — composed, not stored. */
export const methodNarrative = (r: DocCoveredRow): string => {
  const range = rangeText(r);
  const anchor = r.oecd_anchor ? ` (${r.oecd_anchor})` : '';
  return `Best method: ${r.method ?? '—'} on ${r.pli ?? '—'}${anchor}. Arm's-length range ${range}.`;
};

const Kpis: FC<BindingCtx> = () => {
  const { data } = useDocumentation();
  const t = data?.totals;
  const items: KpiItem[] = [
    { key: 'e', label: 'Covered entities', value: String(t?.entities ?? 0), provenance: 'documentation · covered txns' },
    { key: 'c', label: 'Covered transactions', value: String(t?.covered ?? 0) },
    { key: 'r', label: 'Flagged for review', value: String(t?.review ?? 0), tone: (t?.review ?? 0) > 0 ? 'watch' : 'ok', hint: 'actual outside benchmark range' },
    { key: 'd', label: '§6662 packets', value: String(t?.covered ?? 0), hint: 'one evidence packet per covered txn' },
  ];
  return <KpiStrip items={items} />;
};

const Grid: FC<BindingCtx> = () => {
  const { data, loading } = useDocumentation();
  const [evRef, setEvRef] = useState<string | null>(null);
  const [evTitle, setEvTitle] = useState<string | undefined>(undefined);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  const entities = data?.entities ?? [];

  const open = (ref: string, title: string) => { setEvRef(ref); setEvTitle(title); };

  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        IRC §6662(e) contemporaneous documentation, per covered transaction. Each row composes the best-method
        and benchmark narrative with a one-click evidence packet — the audit history, before/after diffs, linked
        ACDOCA postings and hash-chain integrity that establishes the reasonable-cause / good-faith defense.
        Figures derive from the master-data rollup; no number is keyed by hand.
      </Alert>
      {entities.map((e) => (
        <Box key={e.rbukrs}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{e.display_name}</Typography>
            {e.tp_function_label && <Chip size="small" label={e.tp_function_label} variant="outlined" />}
            {e.country && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{e.country}</Typography>}
          </Stack>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Covered transaction</TableCell>
                <TableCell>Counterparty</TableCell>
                <TableCell>Best method · PLI</TableCell>
                <TableCell>Arm&apos;s-length range</TableCell>
                <TableCell>Governing refs</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Evidence</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {e.covered.map((c) => {
                const s = STATUS[c.status] ?? STATUS.na;
                const counterparty = c.payee?.rbukrs === e.rbukrs ? c.payer : c.payee;
                return (
                  <TableRow key={c.ctx_id} hover>
                    <TableCell sx={{ fontWeight: 700 }}>
                      {c.txn_label}
                      {c.oecd_anchor && (
                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>{c.oecd_anchor}</Typography>
                      )}
                    </TableCell>
                    <TableCell>{counterparty?.name ?? '—'}</TableCell>
                    <TableCell>{c.method ?? '—'} · {c.pli ?? '—'}</TableCell>
                    <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{rangeText(c)}</TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {[c.policy_ref, c.ica_ref, c.apa_ref].filter(Boolean).join(' · ') || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={s.label} sx={{ bgcolor: s.color, color: 'white', height: 20, fontWeight: 700 }} />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Open §6662 evidence packet" arrow>
                        <IconButton size="small" onClick={() => open(c.evidence_ref, `${e.display_name} · ${c.txn_label}`)} aria-label={`Evidence for ${c.txn_label}`}>
                          <GavelIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      ))}
      <DocEvidenceDrawer open={!!evRef} onClose={() => setEvRef(null)} recordRef={evRef ?? undefined} title={evTitle} />
    </Stack>
  );
};

export const otp37: ProcessBinding = { kpis: Kpis, tabs: { overview: Grid, calculation: Grid, docs: Grid } };
