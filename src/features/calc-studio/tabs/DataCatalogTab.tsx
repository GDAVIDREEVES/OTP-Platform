import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import EmptyState from '@/shared/components/EmptyState';
import { provKind, PROV_META, CATALOG_KINDS, useCatalog } from '../lib';

/** Data Catalog — every source the platform reads, grouped by tier. Moved out
 *  of the OTP-49 binding (which still re-uses it) when the console grew into
 *  the Calc Studio module. */

export default function DataCatalogTab() {
  const entries = useCatalog();
  const navigate = useNavigate();
  if (entries === null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<StorageOutlinedIcon />}
        title="No catalog sources to show"
        body="The governed data catalog lists every warehouse view, SQLite state table, reference seed and
          calc parameter the platform reads. Nothing was returned for this workspace."
      />
    );
  }

  return (
    <Stack spacing={3}>
      <Alert severity="info" variant="outlined">
        The governed data catalog — every source the platform reads, stitched from four tiers: the read-only
        warehouse views, the mutable SQLite state, the reference seeds, and the calc parameters. Each row
        carries its provenance and the processes that consume it (lineage).
      </Alert>
      {CATALOG_KINDS.map(({ key, label }) => {
        const rows = entries.filter((e) => e.kind === key);
        if (!rows.length) return null;
        return (
          <Box key={key}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              {label} <Chip size="small" label={rows.length} sx={{ ml: 0.5, height: 18 }} />
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell>Provenance</TableCell>
                    <TableCell>Lineage (consuming processes)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((e) => (
                    <TableRow key={e.id} hover>
                      <TableCell sx={{ fontWeight: 700, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{e.name}</TableCell>
                      <TableCell sx={{ maxWidth: 360, color: 'text.secondary' }}>{e.description ?? '—'}</TableCell>
                      <TableCell>
                        <ProvenanceChip
                          source={e.provenance ?? 'assumed'}
                          kind={provKind(e.provenance)}
                          tooltip={PROV_META[provKind(e.provenance)].hint}
                          onClick={
                            e.kind === 'parameter'
                              ? () => navigate(`/evidence/${encodeURIComponent(`param:${e.name}`)}`)
                              : undefined
                          }
                        />
                      </TableCell>
                      <TableCell sx={{ maxWidth: 320, color: 'text.secondary' }}>{e.lineage ?? '—'}</TableCell>
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
