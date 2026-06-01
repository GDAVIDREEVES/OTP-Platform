import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { useEntities, useRoyalties } from '@/shared/providers/DataProvider';
import { formatCurrency } from '@/shared/utils/format';
import type { Entity } from '@/shared/types/entity';
import KpiStrip from '@/kernel/shell/KpiStrip';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

const nameOf = (entities: Entity[], code: string) => entities.find((e) => e.id === code)?.name ?? code;

const Kpis: FC<BindingCtx> = () => {
  const r = useRoyalties();
  const within = r.filter((x) => x.withinBenchmark).length;
  const items: KpiItem[] = [
    { key: 'n', label: 'Royalty arrangements', value: String(r.length) },
    { key: 'w', label: 'Within benchmark', value: `${within}/${r.length}`, tone: within === r.length ? 'ok' : 'watch' },
    { key: 'f', label: 'YTD royalty fees', value: formatCurrency(r.reduce((s, x) => s + (x.ytdFees || 0), 0), 'USD', true) },
  ];
  return <KpiStrip items={items} />;
};

const Rates: FC<BindingCtx> = () => {
  const r = useRoyalties();
  const entities = useEntities();
  const navigate = useNavigate();
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        Rates carry forward from prior year and policy — change what moved, not everything. The arm&rsquo;s-length
        range and a read on defensibility are shown inline, so setting a rate and documenting it are one act.
      </Alert>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>IP</TableCell>
            <TableCell>Licensor → Licensee</TableCell>
            <TableCell align="right">Rate</TableCell>
            <TableCell>Base</TableCell>
            <TableCell>Benchmark range</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {r.map((x) => (
            <TableRow key={x.id} hover>
              <TableCell>{x.ipCategory}</TableCell>
              <TableCell>{nameOf(entities, x.licensor)} → {nameOf(entities, x.licensee)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{x.rate}%</TableCell>
              <TableCell>{x.base}</TableCell>
              <TableCell>
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <span>{x.benchmarkRange}</span>
                  <ProvenanceChip source="benchmark" tooltip="Backed by OTP-25 benchmarking set" onClick={() => navigate('/process/OTP-25/overview')} />
                </Stack>
              </TableCell>
              <TableCell>
                <Chip size="small" label={x.withinBenchmark ? 'In range' : 'Review'} sx={{ bgcolor: x.withinBenchmark ? '#16A34A' : '#D97706', color: 'white', fontWeight: 700, height: 22 }} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  );
};

export const otp3: ProcessBinding = { kpis: Kpis, tabs: { overview: Rates, inputs: Rates } };
