import { useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import { api } from '@/shared/api/client';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useToast } from '@/shared/providers/DataProvider';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import { HistoryButton } from '@/kernel/audit/HistoryDrawer';
import type { Parameter } from '@/shared/api/types';
import { provKind, valueText, PROV_META, useParameters } from '../lib';
import ParamEditDialog from '../components/ParamEditDialog';

/** Drivers & Assumptions — the governed parameter store. Every parameter edit
 *  opens the shared ParamEditDialog (GP5) — required rationale, bounds check,
 *  the "bypasses review" notice — which PATCHes /api/parameters/{key} and is
 *  hash-chained at record_ref="param:{key}", so the per-key evidence packet
 *  lights up automatically. The full history is one click away via the
 *  HistoryButton (GP0) on each row. Moved out of the OTP-49 binding (which still
 *  re-uses it) when the console grew into the Calc Studio module. */

export default function DriversTab() {
  const { params, refresh } = useParameters();
  const user = useSessionUser();
  const toast = useToast();
  const [editing, setEditing] = useState<Parameter | null>(null);

  if (params === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const reset = async (p: Parameter) => {
    try {
      await api.resetParameter(p.key, { actor: user.id });
      toast.show(`Reset ${p.key} to default`, 'success');
      void refresh();
    } catch (e) {
      toast.show(`Reset failed: ${String(e)}`, 'error');
    }
  };

  const isChanged = (p: Parameter) => valueText(p.value) !== valueText(p.default);

  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        The governed parameter store — every calc magnitude that used to be a hardcoded literal scattered
        across routers (CSA growth/PCT, the BEAT §59A thresholds and RACCT→payment-type map, the
        reconciliation tolerance, …) lives here as one editable, auditable row. Each edit hash-chains at{' '}
        <b>param:&#123;key&#125;</b>; the Audit tab and the per-key evidence packet light up automatically.
      </Alert>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Parameter</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Provenance</TableCell>
              <TableCell>Current value</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {params.map((p) => (
              <TableRow key={p.key} hover>
                <TableCell sx={{ maxWidth: 280 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{p.key}</Typography>
                  {p.process_id && (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{p.process_id}</Typography>
                  )}
                </TableCell>
                <TableCell>{p.category && <Chip size="small" label={p.category} />}</TableCell>
                <TableCell>
                  <ProvenanceChip
                    source={p.provenance ?? 'assumed'}
                    kind={provKind(p.provenance)}
                    tooltip={PROV_META[provKind(p.provenance)].hint}
                  />
                </TableCell>
                <TableCell sx={{ maxWidth: 260 }}>
                  <Typography
                    variant="body2"
                    sx={{ fontFamily: 'monospace', fontWeight: 600, overflowWrap: 'anywhere' }}
                  >
                    {valueText(p.value)}
                  </Typography>
                  {isChanged(p) && (
                    <Chip size="small" color="warning" label="changed" sx={{ height: 18, fontSize: 10, mt: 0.5 }} />
                  )}
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
                    <Button size="small" variant="outlined" onClick={() => setEditing(p)}>Edit</Button>
                    {isChanged(p) && (
                      <Button size="small" onClick={() => void reset(p)}>Reset</Button>
                    )}
                    <HistoryButton recordRef={`param:${p.key}`} />
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <ParamEditDialog
        open={editing !== null}
        param={editing}
        onClose={() => setEditing(null)}
        onSaved={() => void refresh()}
      />
    </Stack>
  );
}
