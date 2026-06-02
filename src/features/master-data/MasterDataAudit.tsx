import {
  Box, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography, Button,
} from '@mui/material';
import { useAudit } from '@/kernel/audit/useAudit';

export default function MasterDataAudit() {
  const { events, loading, verify, runVerify } = useAudit({ processId: 'MASTER-DATA' });
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  return (
    <Paper variant="outlined">
      <Stack direction="row" alignItems="center" sx={{ p: 2, pb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>Master data audit</Typography>
        <Button size="small" onClick={runVerify}>Verify chain</Button>
        {verify && <Chip size="small" label={verify.ok ? 'Chain OK' : `Broken @ ${verify.broken_at}`} color={verify.ok ? 'success' : 'error'} sx={{ ml: 1 }} />}
      </Stack>
      <Table size="small">
        <TableHead>
          <TableRow><TableCell>When</TableCell><TableCell>Actor</TableCell><TableCell>Event</TableCell><TableCell>Record</TableCell></TableRow>
        </TableHead>
        <TableBody>
          {events.map((e) => (
            <TableRow key={e.id} hover>
              <TableCell><Typography variant="caption">{new Date(e.ts).toLocaleString()}</Typography></TableCell>
              <TableCell>{e.actor} <Chip size="small" label={e.actor_kind} sx={{ height: 16, ml: 0.5 }} /></TableCell>
              <TableCell>{e.event_type}</TableCell>
              <TableCell><Typography variant="caption" sx={{ color: 'text.secondary' }}>{e.record_ref}</Typography></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}
