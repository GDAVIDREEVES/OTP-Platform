import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import type { CalcRun } from '@/shared/api/types';
import { valueText } from '../lib';

/** Runs — the global job console over GET /api/runs, newest first. Each run
 *  persists its digest, summary and trace (never the output body) and is
 *  hash-chained at record_ref="calc:{id}", so the Evidence link resolves to
 *  the full audited run history. */

/** Compact "k=v · k=v" line from a run's summary extract, '' when empty. */
function summaryText(summary: Record<string, unknown> | null): string {
  if (!summary) return '';
  return Object.entries(summary)
    .map(([k, v]) => `${k}=${valueText(v)}`)
    .join(' · ');
}

export default function RunsTab() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<CalcRun[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    api.runs().then(setRuns).catch(() => setRuns([]));
    api.calcs()
      .then((ds) => setNames(Object.fromEntries(ds.map((d) => [d.id, d.name]))))
      .catch(() => {});
  }, []);

  if (runs === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        The job console — every calculation run across the platform, newest first. Each run persists
        its sha256 digest, summary and trace (never the output body) and hash-chains a <b>run</b> event
        at <b>calc:&#123;id&#125;</b>; the Evidence link opens the full audited history.
      </Alert>
      {runs.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>No runs yet</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            Open a calculation on the Calculations tab and press “Run now” — the run lands here.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Ran at</TableCell>
                <TableCell>Calculation</TableCell>
                <TableCell>Actor</TableCell>
                <TableCell>Scenario</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Duration</TableCell>
                <TableCell>Digest</TableCell>
                <TableCell align="right">Evidence</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(r.ts).toLocaleString()}</TableCell>
                  <TableCell sx={{ maxWidth: 300 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {names[r.calc_id] ?? r.calc_id}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
                      {summaryText(r.summary) || r.calc_id}
                    </Typography>
                  </TableCell>
                  <TableCell>{r.actor}</TableCell>
                  <TableCell>
                    {r.scenario_id ? (
                      <Chip size="small" color="primary" variant="outlined" label={r.scenario_id} sx={{ height: 20, fontSize: 11 }} />
                    ) : (
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>—</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={r.status === 'succeeded' ? 'success' : 'error'}
                      label={r.status}
                      sx={{ height: 20, fontSize: 11 }}
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {r.duration_ms != null ? `${r.duration_ms} ms` : '—'}
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {r.output_digest ? r.output_digest.slice(0, 12) : '—'}
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      onClick={() => navigate(`/evidence/${encodeURIComponent(`calc:${r.calc_id}`)}`)}
                    >
                      Evidence
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}
