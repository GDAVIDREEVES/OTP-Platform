import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import { formatNumber } from '@/shared/utils/format';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import { PROV_META, PROV_ORDER, useProvenance } from '../lib';

/** Provenance dashboard — the real-vs-fabricated rollup across every governed
 *  source. Moved out of the OTP-49 binding (which still re-uses it) when the
 *  console grew into the Calc Studio module. */

export default function ProvenanceTab() {
  const roll = useProvenance();
  const navigate = useNavigate();
  if (roll === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const pct = (n: number) => (roll.total ? ((n / roll.total) * 100).toFixed(0) : '0');

  return (
    <Stack spacing={3}>
      <Alert severity="info" variant="outlined">
        Real-vs-fabricated rollup across every governed source. {formatNumber(roll.total)} sources in total.
        The fabricated bucket is the honest inventory of every magnitude invented for the demo — treasury
        principals, WHT treaty rates, the CbCR table, allocation keys, the guarantee / captive / customs /
        VAT / FX seeds, and the BEAT RACCT→payment-type map — each deep-linking to its catalog entry.
      </Alert>

      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2 }}>
        {PROV_ORDER.map((p) => {
          const b = roll.buckets[p];
          return (
            <Paper key={p} variant="outlined" sx={{ p: 2, minWidth: 180, flex: 1 }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <ProvenanceChip source={PROV_META[p].label} kind={p} />
              </Stack>
              <Typography variant="h4" sx={{ fontWeight: 800, mt: 1 }}>{b?.count ?? 0}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {pct(b?.count ?? 0)}% of sources · {PROV_META[p].hint}
              </Typography>
            </Paper>
          );
        })}
      </Stack>

      {PROV_ORDER.map((p) => {
        const b = roll.buckets[p];
        if (!b || !b.count) return null;
        return (
          <Box key={p}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              <ProvenanceChip source={PROV_META[p].label} kind={p} /> {' '}
              <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>— {b.count} source(s)</Box>
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Source</TableCell>
                    <TableCell>Kind</TableCell>
                    <TableCell align="right">Catalog id</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {b.items.map((it) => (
                    <TableRow
                      key={it.id}
                      hover
                      sx={{ cursor: it.kind === 'parameter' ? 'pointer' : 'default' }}
                      onClick={
                        it.kind === 'parameter'
                          ? () => navigate(`/evidence/${encodeURIComponent(`param:${it.name}`)}`)
                          : undefined
                      }
                    >
                      <TableCell sx={{ fontWeight: 700, fontFamily: 'monospace' }}>{it.name}</TableCell>
                      <TableCell><Chip size="small" label={it.kind} /></TableCell>
                      <TableCell align="right" sx={{ color: 'text.secondary', fontFamily: 'monospace', fontSize: 12 }}>{it.id}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        );
      })}
    </Stack>
  );
}
