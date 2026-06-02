import { useEffect, useState } from 'react';
import {
  Box, CircularProgress, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography, Chip,
} from '@mui/material';
import { api } from '@/shared/api/client';
import type { MdTransactionType, TpFunction } from '@/shared/api/types';

export default function TransactionMaster() {
  const [types, setTypes] = useState<MdTransactionType[] | null>(null);
  const [fns, setFns] = useState<TpFunction[]>([]);
  useEffect(() => {
    api.mdTransactionTypes().then(setTypes).catch(() => setTypes([]));
    api.mdFunctions().then(setFns).catch(() => setFns([]));
  }, []);
  const label = (code: string) => fns.find((f) => f.code === code)?.label ?? code;

  if (types === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  return (
    <Paper variant="outlined">
      <Box sx={{ p: 2, pb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Transaction master</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Each covered transaction type: the characterising function selects it, and it carries the method, PLI and benchmark.
        </Typography>
      </Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Type</TableCell><TableCell>Category</TableCell><TableCell>Characterising function</TableCell>
            <TableCell>Method</TableCell><TableCell>PLI</TableCell><TableCell>Benchmark</TableCell><TableCell>OECD</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {types.map((t) => (
            <TableRow key={t.txn_type_id} hover>
              <TableCell sx={{ fontWeight: 600 }}>{t.label}</TableCell>
              <TableCell><Chip size="small" label={t.category} sx={{ height: 20 }} /></TableCell>
              <TableCell>{label(t.characterising_function)}</TableCell>
              <TableCell>{t.method}</TableCell>
              <TableCell>{t.pli}</TableCell>
              <TableCell>{t.benchmark_set_id}</TableCell>
              <TableCell><Typography variant="caption" sx={{ color: 'text.secondary' }}>{t.oecd_anchor}</Typography></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}
