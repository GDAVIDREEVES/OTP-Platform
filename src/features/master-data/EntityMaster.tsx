import { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useToast } from '@/shared/providers/DataProvider';
import type { MdEntityRow, TpFunction } from '@/shared/api/types';

const OVERLAY = '#FAF5FF';

export default function EntityMaster() {
  const user = useSessionUser();
  const toast = useToast();
  const [rows, setRows] = useState<MdEntityRow[] | null>(null);
  const [fns, setFns] = useState<TpFunction[]>([]);
  const [pick, setPick] = useState<Record<string, string>>({});

  const load = () => api.mdEntities().then(setRows).catch(() => setRows([]));
  useEffect(() => {
    load();
    api.mdFunctions().then(setFns).catch(() => setFns([]));
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, MdEntityRow[]>();
    for (const r of rows ?? []) {
      if (!m.has(r.rbukrs)) m.set(r.rbukrs, []);
      m.get(r.rbukrs)!.push(r);
    }
    return Array.from(m.entries());
  }, [rows]);

  const addFunction = async (rbukrs: string) => {
    const code = pick[rbukrs];
    if (!code) return;
    const fn = fns.find((f) => f.code === code);
    try {
      await api.mdAddEntityFunction({
        rbukrs,
        tp_function_code: code,
        tested_party: fn?.typically_tested ?? false,
        applies_to: [],
        actor: user.id,
      });
      toast.show('Function added — audited', 'success');
      setPick((p) => ({ ...p, [rbukrs]: '' }));
      load();
    } catch (e) {
      toast.show(`Add failed: ${String(e)}`, 'error');
    }
  };

  if (rows === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  return (
    <Paper variant="outlined">
      <Box sx={{ p: 2, pb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Entity master</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          One row per function — an entity can hold several. SAP identity is read-only; the TP characterisation (tinted) is the governed overlay.
        </Typography>
      </Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>RBUKRS</TableCell><TableCell>Legal entity</TableCell><TableCell>Country</TableCell>
            <TableCell sx={{ bgcolor: OVERLAY }}>TP function</TableCell>
            <TableCell sx={{ bgcolor: OVERLAY }}>Tested</TableCell>
            <TableCell sx={{ bgcolor: OVERLAY }}>Currency</TableCell>
            <TableCell sx={{ bgcolor: OVERLAY }}>Participates in</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {grouped.map(([rbukrs, g]) => {
            const have = new Set(g.map((r) => r.tp_function_code));
            const available = fns.filter((f) => !have.has(f.code));
            return [
              ...g.map((r, i) => (
                <TableRow key={`${r.rbukrs}-${r.tp_function_code}`} hover>
                  <TableCell sx={{ fontWeight: 700, borderTop: i === 0 ? '2px solid #E2E8F0' : undefined }}>{i === 0 ? r.rbukrs : ''}</TableCell>
                  <TableCell sx={{ borderTop: i === 0 ? '2px solid #E2E8F0' : undefined }}>{i === 0 ? r.display_name : ''}</TableCell>
                  <TableCell sx={{ borderTop: i === 0 ? '2px solid #E2E8F0' : undefined }}>{i === 0 ? r.country : ''}</TableCell>
                  <TableCell sx={{ bgcolor: OVERLAY, fontWeight: 600 }}>{r.tp_function_label}{r.is_primary ? ' ·primary' : ''}</TableCell>
                  <TableCell sx={{ bgcolor: OVERLAY }}>{r.tested_party ? '✓' : '—'}</TableCell>
                  <TableCell sx={{ bgcolor: OVERLAY }}>{r.functional_currency ?? '—'}</TableCell>
                  <TableCell sx={{ bgcolor: OVERLAY }}>{i === 0 ? r.participates_in.map((a) => <Chip key={a} size="small" label={a} sx={{ mr: 0.5, mb: 0.5, height: 20 }} />) : ''}</TableCell>
                </TableRow>
              )),
              <TableRow key={`${rbukrs}-add`}>
                <TableCell />
                <TableCell colSpan={6} sx={{ bgcolor: '#FDFCFF' }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Select
                      size="small"
                      displayEmpty
                      value={pick[rbukrs] ?? ''}
                      onChange={(e) => setPick((p) => ({ ...p, [rbukrs]: e.target.value }))}
                      sx={{ minWidth: 230, fontSize: 13 }}
                    >
                      <MenuItem value=""><em>+ add function…</em></MenuItem>
                      {available.map((f) => <MenuItem key={f.code} value={f.code}>{f.label}</MenuItem>)}
                    </Select>
                    <Button size="small" variant="outlined" disabled={!pick[rbukrs]} onClick={() => addFunction(rbukrs)}>Add</Button>
                  </Stack>
                </TableCell>
              </TableRow>,
            ];
          })}
        </TableBody>
      </Table>
    </Paper>
  );
}
