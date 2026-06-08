import { useState } from 'react';
import type { FC } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { tokens } from '@/shared/theme';
import KpiStrip from '@/kernel/shell/KpiStrip';
import DocEvidenceDrawer from '@/kernel/data/DocEvidenceDrawer';
import type { DocCoveredRow } from '@/shared/api/types';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';
import { rangeText, useDocumentation } from './otp37';

const STATUS: Record<string, { label: string; color: string }> = {
  in_range: { label: 'In range', color: tokens.ok },
  review: { label: 'Review', color: tokens.watch },
  na: { label: 'CUP / qual.', color: '#64748B' },
};

const Kpis: FC<BindingCtx> = () => {
  const { data } = useDocumentation();
  const t = data?.totals;
  const items: KpiItem[] = [
    { key: 'e', label: 'Local File entities', value: String(t?.entities ?? 0), provenance: 'documentation · OECD Ch. V' },
    { key: 'c', label: 'Controlled transactions', value: String(t?.covered ?? 0) },
    { key: 'r', label: 'Outside range', value: String(t?.review ?? 0), tone: (t?.review ?? 0) > 0 ? 'watch' : 'ok' },
  ];
  return <KpiStrip items={items} />;
};

const counterpartyOf = (c: DocCoveredRow, rbukrs: string) =>
  (c.payee?.rbukrs === rbukrs ? c.payer : c.payee);

const LocalFile: FC<BindingCtx> = () => {
  const { data, loading } = useDocumentation();
  const [evRef, setEvRef] = useState<string | null>(null);
  const [evTitle, setEvTitle] = useState<string | undefined>(undefined);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  const entities = data?.entities ?? [];

  return (
    <Stack spacing={2.5}>
      <Alert severity="info" variant="outlined">
        OECD Local File (TPG Chapter V), assembled per local entity from the covered-transaction rollup: the
        controlled transactions, the selected method and arm&apos;s-length range, the governing intercompany /
        APA references, and a linked evidence packet. Same source as the §6662 workpaper — one rollup, both filings.
      </Alert>
      {entities.map((e) => (
        <Paper key={e.rbukrs} variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <DescriptionOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{e.display_name}</Typography>
            {e.tp_function_label && <Chip size="small" label={e.tp_function_label} variant="outlined" />}
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {[e.country, e.functional_currency].filter(Boolean).join(' · ')}
            </Typography>
            <Button
              size="small"
              startIcon={<DescriptionOutlinedIcon />}
              onClick={() => { setEvRef(e.evidence_ref); setEvTitle(`${e.display_name} · Local File evidence`); }}
            >
              Evidence
            </Button>
          </Stack>

          <Typography variant="overline" sx={{ color: 'text.secondary' }}>B. Controlled transactions</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Transaction</TableCell>
                <TableCell>Counterparty</TableCell>
                <TableCell>Method · PLI</TableCell>
                <TableCell>Arm&apos;s-length range</TableCell>
                <TableCell>ICA / APA</TableCell>
                <TableCell>Result</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {e.covered.map((c) => {
                const s = STATUS[c.status] ?? STATUS.na;
                const cp = counterpartyOf(c, e.rbukrs);
                return (
                  <TableRow key={c.ctx_id} hover>
                    <TableCell sx={{ fontWeight: 700 }}>{c.txn_label}</TableCell>
                    <TableCell>{cp?.name ?? '—'}</TableCell>
                    <TableCell>{c.method ?? '—'} · {c.pli ?? '—'}</TableCell>
                    <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{rangeText(c)}</TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {[c.ica_ref, c.apa_ref].filter(Boolean).join(' · ') || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={s.label} sx={{ bgcolor: s.color, color: 'white', height: 20, fontWeight: 700 }} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Paper>
      ))}
      <DocEvidenceDrawer open={!!evRef} onClose={() => setEvRef(null)} recordRef={evRef ?? undefined} title={evTitle} />
    </Stack>
  );
};

export const otp32: ProcessBinding = { kpis: Kpis, tabs: { overview: LocalFile, calculation: LocalFile, docs: LocalFile } };
