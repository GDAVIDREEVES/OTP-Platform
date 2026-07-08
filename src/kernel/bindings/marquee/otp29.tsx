import type { FC } from 'react';
import { Box, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography, Alert } from '@mui/material';
import { useEntities } from '@/shared/providers/DataProvider';
import type { Entity } from '@/shared/types/entity';
import KpiStrip from '@/kernel/shell/KpiStrip';
import { useReference } from '@/kernel/data/useReference';
import Term from '@/shared/components/Term';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

interface Intangible { intangible_id: string; name: string; type: string; legal_owner_rbukrs: string; chain_ids: string[] }
interface Alloc { intangible_id: string; rbukrs: string; develop: number; enhance: number; maintain: number; protect: number; exploit: number; fte: number; notes: string }

const nameOf = (entities: Entity[], code: string) => entities.find((e) => e.id === code)?.name ?? code;

const Kpis: FC<BindingCtx> = () => {
  const { data: intan } = useReference<{ intangibles: Intangible[] }>('intangibles');
  const { data: dempe } = useReference<{ allocations: Alloc[] }>('dempe');
  const allocs = dempe?.allocations ?? [];
  const items: KpiItem[] = [
    { key: 'i', label: 'Intangibles', value: String(intan?.intangibles?.length ?? 0) },
    { key: 'e', label: 'Contributing entities', value: String(new Set(allocs.map((a) => a.rbukrs)).size) },
    { key: 'f', label: 'DEMPE FTE', value: String(allocs.reduce((s, a) => s + a.fte, 0)) },
  ];
  return <KpiStrip items={items} />;
};

const fnCols: { key: keyof Alloc; label: string }[] = [
  { key: 'develop', label: 'Develop' },
  { key: 'enhance', label: 'Enhance' },
  { key: 'maintain', label: 'Maintain' },
  { key: 'protect', label: 'Protect' },
  { key: 'exploit', label: 'Exploit' },
];

const Dempe: FC<BindingCtx> = () => {
  const entities = useEntities();
  const { data: intan, loading: l1 } = useReference<{ intangibles: Intangible[] }>('intangibles');
  const { data: dempe, loading: l2 } = useReference<{ allocations: Alloc[] }>('dempe');
  if (l1 || l2) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  const intangibles = intan?.intangibles ?? [];
  const allocs = dempe?.allocations ?? [];
  return (
    <Stack spacing={3}>
      <Alert severity="info" variant="outlined">
        Functions, assets, and risks behind each intangible — the <Term k="DEMPE">DEMPE</Term> functions
        Develop, Enhance, Maintain, Protect, Exploit — allocated across the group. Substance, not legal
        ownership, drives the return.
      </Alert>
      {intangibles.map((ip) => (
        <Box key={ip.intangible_id}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{ip.name}</Typography>
            <Chip size="small" label={ip.type} variant="outlined" />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Legal owner: {nameOf(entities, ip.legal_owner_rbukrs)}
            </Typography>
          </Stack>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Entity</TableCell>
                {fnCols.map((c) => <TableCell key={c.key} align="right">{c.label}</TableCell>)}
                <TableCell align="right">FTE</TableCell>
                <TableCell>Role</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {allocs.filter((a) => a.intangible_id === ip.intangible_id).map((a) => (
                <TableRow key={a.rbukrs} hover>
                  <TableCell sx={{ fontWeight: 700 }}>{nameOf(entities, a.rbukrs)}</TableCell>
                  {fnCols.map((c) => <TableCell key={c.key} align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{a[c.key]}%</TableCell>)}
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{a.fte}</TableCell>
                  <TableCell><Typography variant="caption" sx={{ color: 'text.secondary' }}>{a.notes}</Typography></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      ))}
    </Stack>
  );
};

export const otp29: ProcessBinding = { kpis: Kpis, tabs: { overview: Dempe } };
