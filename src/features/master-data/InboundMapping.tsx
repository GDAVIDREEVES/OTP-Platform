import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import AgenticHandoffMarker from '@/kernel/workflow/AgenticHandoffMarker';
import type { MdStagingItem } from '@/shared/api/types';
import { useMappingWorkflow } from './useMappingWorkflow';

const STATUS_COLOR: Record<string, string> = {
  unmapped: '#D97706', proposed: '#7C3AED', in_review: '#2563EB', applied: '#16A34A', rejected: '#DC2626',
};

export default function InboundMapping({ onChange }: { onChange?: () => void }) {
  const [items, setItems] = useState<MdStagingItem[] | null>(null);
  const refresh = () => api.mdStaging().then(setItems).catch(() => setItems([]));
  useEffect(() => { refresh(); }, []);
  const wf = useMappingWorkflow(() => { refresh(); onChange?.(); });

  const simulate = async () => { await api.mdSimulate(); refresh(); };

  if (items === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center">
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Inbound SAP mapping</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Unrecognised SAP items, characterised with AI assistance and applied only after human sign-off.
          </Typography>
        </Box>
        <Button variant="outlined" size="small" onClick={simulate}>⟳ Simulate SAP delta</Button>
      </Stack>

      {items.length === 0 && <Alert severity="success">All caught up — no unmapped items.</Alert>}

      {items.map((it) => {
        const p = wf.proposal[it.id];
        const proposed = p?.proposed ?? it.proposed;
        return (
          <Paper key={it.id} variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Chip size="small" label={it.kind} />
              <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>{JSON.stringify(it.raw)}</Typography>
              <Chip size="small" label={it.status} sx={{ bgcolor: STATUS_COLOR[it.status], color: 'white', height: 20 }} />
            </Stack>

            {proposed && (
              <Box sx={{ mt: 1.5 }}>
                <AgenticHandoffMarker summary={(p?.rationale ?? it.rationale) || 'Research Brain proposed a mapping.'} />
                <Table size="small" sx={{ mt: 1, maxWidth: 520 }}>
                  <TableBody>
                    {Object.entries(proposed).map(([k, v]) => (
                      <TableRow key={k}>
                        <TableCell sx={{ color: 'text.secondary', width: 180 }}>{k}</TableCell>
                        <TableCell sx={{ bgcolor: '#FAF5FF', fontWeight: 600 }}>{String(v)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {p?.confidence && <Typography variant="caption" sx={{ color: 'text.secondary' }}>Confidence: {p.confidence}{p.live ? ' · live' : ' · offline'}</Typography>}
              </Box>
            )}

            <Stack direction="row" spacing={1.5} sx={{ mt: 1.5 }}>
              {it.status === 'unmapped' && (
                <Button variant="contained" disabled={wf.busyId === it.id} onClick={() => wf.propose(it.id)}
                  startIcon={wf.busyId === it.id ? <CircularProgress size={16} color="inherit" /> : undefined}>
                  🧠 Propose mapping
                </Button>
              )}
              {(it.status === 'proposed' || (proposed && it.status === 'unmapped')) && (
                <Button variant="contained" disabled={wf.busyId === it.id} onClick={() => wf.submit(it.id)}>Submit for review →</Button>
              )}
              {it.status === 'in_review' && (
                <Button variant="contained" color="success" disabled={wf.busyId === it.id} onClick={() => wf.approve(it.id)}>
                  Approve &amp; apply (as {wf.user.name})
                </Button>
              )}
            </Stack>
            {it.status === 'in_review' && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                Maker {it.maker} submitted. A different reviewer must approve (switch role from the avatar). The AI can never be the checker.
              </Typography>
            )}
          </Paper>
        );
      })}
    </Stack>
  );
}
