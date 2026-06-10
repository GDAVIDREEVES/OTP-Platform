import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import type { CalcDef } from '@/shared/api/types';
import CalcDetailDrawer from '../components/CalcDetailDrawer';

/** Calculations — the registry of every computed endpoint the platform serves
 *  (seeds/calculations/calculations.v1.json), each with its most recent run.
 *  Row click opens the detail drawer: definition, resolved inputs, run history
 *  and "Run now". A `?calc={id}` query param auto-opens the drawer (the
 *  Lineage graph deep-links here). No figures are invented here — every row
 *  is read from GET /api/calcs. */

export default function CalculationsTab() {
  const [defs, setDefs] = useState<CalcDef[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const refresh = () => api.calcs().then(setDefs).catch(() => setDefs([]));
  useEffect(() => { void refresh(); }, []);

  // Deep link from the Lineage graph: ?calc={id} auto-opens the drawer.
  const deepLink = searchParams.get('calc');
  useEffect(() => {
    if (deepLink) setSelected(deepLink);
  }, [deepLink]);

  const closeDrawer = () => {
    setSelected(null);
    if (searchParams.has('calc')) {
      const next = new URLSearchParams(searchParams);
      next.delete('calc');
      setSearchParams(next, { replace: true });
    }
  };

  if (defs === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        The calculation registry — every computed endpoint the platform serves, with its formula, the
        governed inputs it reads, and its run history. Click a row to inspect the definition and run it
        now; each run hash-chains a <b>run</b> event at <b>calc:&#123;id&#125;</b>.
      </Alert>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Calculation</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Process</TableCell>
              <TableCell>Scenarios</TableCell>
              <TableCell>Last run</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {defs.map((d) => (
              <TableRow key={d.id} hover sx={{ cursor: 'pointer' }} onClick={() => setSelected(d.id)}>
                <TableCell sx={{ maxWidth: 320 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{d.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>{d.id}</Typography>
                </TableCell>
                <TableCell><Chip size="small" label={d.type} /></TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{d.process_id}</TableCell>
                <TableCell>
                  {d.scenario_capable ? (
                    <Chip
                      size="small"
                      color="primary"
                      variant="outlined"
                      label="scenario-capable"
                      sx={{ height: 20, fontSize: 11 }}
                    />
                  ) : (
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>—</Typography>
                  )}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {d.last_run ? (
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Chip
                        size="small"
                        color={d.last_run.status === 'succeeded' ? 'success' : 'error'}
                        label={d.last_run.status}
                        sx={{ height: 20, fontSize: 11 }}
                      />
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {new Date(d.last_run.ts).toLocaleString()}
                      </Typography>
                    </Stack>
                  ) : (
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>never run</Typography>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <CalcDetailDrawer
        open={selected !== null}
        calcId={selected}
        onClose={closeDrawer}
        onChanged={() => void refresh()}
      />
    </Stack>
  );
}
