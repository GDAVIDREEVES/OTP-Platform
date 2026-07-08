import { useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import { api } from '@/shared/api/client';
import type { CalcGraph } from '@/shared/api/types';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import EmptyState from '@/shared/components/EmptyState';
import { PROV_META, PROV_ORDER } from '../lib';
import LineageGraph from '../components/LineageGraph';

/** Lineage — the dependency DAG over GET /api/calcs/graph (CS-d): every
 *  governed source and driver, the calculation that reads it, and the process
 *  it serves, assembled from the calculation registry seed. Node colours are
 *  the provenance semantics used everywhere else; clicking drills through. */

export default function LineageTab() {
  const [graph, setGraph] = useState<CalcGraph | null>(null);

  useEffect(() => {
    api.calcsGraph().then(setGraph).catch(() => setGraph({ nodes: [], edges: [] }));
  }, []);

  if (graph === null) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  }

  if (graph.nodes.length === 0) {
    return (
      <EmptyState
        icon={<AccountTreeOutlinedIcon />}
        title="No lineage to show yet"
        body="The dependency graph is assembled from the calculation registry. Run a calculation and its
          sources, drivers and downstream processes will thread together here."
        cta={{ label: 'Go to Runs', to: '/calc-studio/runs' }}
      />
    );
  }

  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        The dependency graph — sources → drivers → calculations → processes, assembled from the
        calculation registry. Click to drill through: a source opens the Data Catalog, a driver its
        evidence packet, a calculation its definition, a process its workspace.
      </Alert>
      <Stack direction="row" alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
          Provenance
        </Typography>
        {PROV_ORDER.map((p) => (
          <ProvenanceChip key={p} source={PROV_META[p].label} kind={p} tooltip={PROV_META[p].hint} />
        ))}
      </Stack>
      <Paper variant="outlined" sx={{ p: 2, overflowX: 'auto' }}>
        <LineageGraph graph={graph} />
      </Paper>
    </Stack>
  );
}
