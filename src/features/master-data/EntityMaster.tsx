import { useEffect, useMemo, useState } from 'react';
import {
  Box, CircularProgress, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography, Chip,
} from '@mui/material';
import { api } from '@/shared/api/client';
import type { MdEntityRow } from '@/shared/api/types';

const OVERLAY = '#FAF5FF';

export default function EntityMaster() {
  const [rows, setRows] = useState<MdEntityRow[] | null>(null);
  useEffect(() => { api.mdEntities().then(setRows).catch(() => setRows([])); }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, MdEntityRow[]>();
    for (const r of rows ?? []) {
      const k = r.rbukrs;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return Array.from(m.values());
  }, [rows]);

  if (rows === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  return (
    <Paper variant="outlined">
      <Box sx={{ p: 2, pb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Entity master</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          One row per function. SAP identity is read-only; the TP characterisation (tinted) is the governed overlay.
        </Typography>
      </Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>RBUKRS</TableCell><TableCell>Legal entity</TableCell><TableCell>Country</TableCell>
            <TableCell sx={{ bgcolor: OVERLAY }}>TP function</TableCell>
            <TableCell sx={{ bgcolor: OVERLAY }}>Tested</TableCell>
            <TableCell sx={{ bgcolor: OVERLAY }}>Currency</TableCell>
            <TableCell sx={{ bgcolor: OVERLAY }}>Applies to</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {grouped.map((g) =>
            g.map((r, i) => (
              <TableRow key={`${r.rbukrs}-${r.tp_function_code}`} hover>
                <TableCell sx={{ fontWeight: 700, borderTop: i === 0 ? '2px solid #E2E8F0' : undefined }}>{i === 0 ? r.rbukrs : ''}</TableCell>
                <TableCell sx={{ borderTop: i === 0 ? '2px solid #E2E8F0' : undefined }}>{i === 0 ? r.display_name : ''}</TableCell>
                <TableCell sx={{ borderTop: i === 0 ? '2px solid #E2E8F0' : undefined }}>{i === 0 ? r.country : ''}</TableCell>
                <TableCell sx={{ bgcolor: OVERLAY, fontWeight: 600 }}>{r.tp_function_label}{r.is_primary ? ' ·primary' : ''}</TableCell>
                <TableCell sx={{ bgcolor: OVERLAY }}>{r.tested_party ? '✓' : '—'}</TableCell>
                <TableCell sx={{ bgcolor: OVERLAY }}>{r.functional_currency ?? '—'}</TableCell>
                <TableCell sx={{ bgcolor: OVERLAY }}>{r.applies_to.map((a) => <Chip key={a} size="small" label={a} sx={{ mr: 0.5, height: 20 }} />)}</TableCell>
              </TableRow>
            )),
          )}
        </TableBody>
      </Table>
    </Paper>
  );
}
