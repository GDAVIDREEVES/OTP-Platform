import { useEffect, useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import { api } from '@/shared/api/client';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useToast } from '@/shared/providers/DataProvider';
import DrillDrawer from '@/kernel/data/DrillDrawer';
import type { MdMatrixRow } from '@/shared/api/types';

const OVERLAY = '#FAF5FF';
const STATUS: Record<string, { label: string; color: string }> = {
  in_range: { label: 'In range', color: '#16A34A' },
  review: { label: 'Review', color: '#D97706' },
  na: { label: '—', color: '#94A3B8' },
};

type OverlayField = 'policy_ref' | 'ica_ref' | 'apa_ref';

export default function TransactionMatrix() {
  const user = useSessionUser();
  const toast = useToast();
  const [rows, setRows] = useState<MdMatrixRow[] | null>(null);
  const [drill, setDrill] = useState<{ id: string; name: string } | null>(null);

  const load = () => api.mdMatrix().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const editOverlay = async (r: MdMatrixRow, field: OverlayField) => {
    const next = window.prompt(`Edit ${field} for ${r.txn_label}`, (r[field] as string) ?? '');
    if (next === null) return;
    const body: { policy_ref?: string; ica_ref?: string; apa_ref?: string; actor: string } = { actor: user.id };
    body[field] = next;
    try {
      await api.mdPutOverlay(r.ctx_id, body);
      toast.show('Overlay updated — audited', 'success');
      load();
    } catch (e) {
      toast.show(`Update failed: ${String(e)}`, 'error');
    }
  };

  if (rows === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  return (
    <Paper variant="outlined">
      <Stack direction="row" alignItems="center" sx={{ p: 2, pb: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Master transaction matrix</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            One row per covered transaction. Grey = SAP-derived (drill to source); tinted = editable TP overlay (audited).
          </Typography>
        </Box>
        <Button size="small" startIcon={<PrintIcon />} onClick={() => window.print()}>Export</Button>
      </Stack>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ whiteSpace: 'nowrap' }}>
          <TableHead>
            <TableRow>
              <TableCell>Transaction</TableCell><TableCell>Payer (role)</TableCell><TableCell>Tested (role)</TableCell>
              <TableCell>Method</TableCell><TableCell sx={{ bgcolor: OVERLAY }}>PLI · actual vs range</TableCell><TableCell>Status</TableCell>
              <TableCell sx={{ bgcolor: OVERLAY }}>Policy</TableCell><TableCell sx={{ bgcolor: OVERLAY }}>ICA</TableCell><TableCell sx={{ bgcolor: OVERLAY }}>APA</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => {
              const s = STATUS[r.status];
              const range = r.lower != null ? `${r.lower}–${r.upper}${r.unit ?? ''}` : '—';
              const actual = r.actual != null ? `${r.actual}${r.unit ?? ''} vs ` : '';
              return (
                <TableRow key={r.ctx_id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{r.txn_label}</TableCell>
                  <TableCell>{r.payer.name} <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>({r.payer.role})</Typography></TableCell>
                  <TableCell
                    onClick={() => setDrill({ id: r.tested.rbukrs, name: r.tested.name })}
                    sx={{ cursor: 'pointer', color: '#2563EB' }}
                  >
                    {r.tested.name} <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>({r.tested.role})</Typography>
                  </TableCell>
                  <TableCell>{r.method}</TableCell>
                  <TableCell sx={{ bgcolor: OVERLAY }}>{actual}{range}</TableCell>
                  <TableCell><Chip size="small" label={s.label} sx={{ bgcolor: s.color, color: 'white', height: 20, fontWeight: 700 }} /></TableCell>
                  <TableCell sx={{ bgcolor: OVERLAY, cursor: 'pointer' }} onClick={() => editOverlay(r, 'policy_ref')}>{r.policy_ref ?? '✎'}</TableCell>
                  <TableCell sx={{ bgcolor: OVERLAY, cursor: 'pointer' }} onClick={() => editOverlay(r, 'ica_ref')}>{r.ica_ref ?? '✎'}</TableCell>
                  <TableCell sx={{ bgcolor: OVERLAY, cursor: 'pointer' }} onClick={() => editOverlay(r, 'apa_ref')}>{r.apa_ref ?? '✎'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
      <DrillDrawer open={!!drill} onClose={() => setDrill(null)} entityId={drill?.id} entityName={drill?.name} />
    </Paper>
  );
}
