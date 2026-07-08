import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, CircularProgress, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import GridOnIcon from '@mui/icons-material/GridOn';
import { api } from '@/shared/api/client';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useToast } from '@/shared/providers/DataProvider';
import { useRefreshSignals } from '@/shared/providers/WorkSignalsProvider';
import { useReviewHandoff } from '@/kernel/review/ReviewHandoff';
import LifecycleChip from '@/shared/components/LifecycleChip';
import { HistoryButton } from '@/kernel/audit/HistoryDrawer';
import type { AuthoredDataset } from '@/shared/api/types';

/** Datasets — the registry of every authored data-prep graph (Phase 8 DS2).
 *  Until now these were authored on the cockpit and then INVISIBLE: they only
 *  surfaced inside source-picker dropdowns. This tab is their home — mirroring
 *  the Calculations registry idiom (list + per-row lifecycle actions + audit
 *  history). Each row is read from GET /api/datasets; nothing is invented. The
 *  lifecycle (draft → tested → in_review → active, maker-checker at
 *  dataset:{id}) is driven from here: Test compiles + runs the graph (the
 *  activation gate); Submit for activation opens the same review handoff the
 *  cockpit fires; Open in cockpit round-trips the graph onto the canvas
 *  (?dataset={id}). */

export default function DatasetsTab() {
  const navigate = useNavigate();
  const user = useSessionUser();
  const toast = useToast();
  const refreshSignals = useRefreshSignals();
  const { notifySubmitted } = useReviewHandoff();
  const [datasets, setDatasets] = useState<AuthoredDataset[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => {
    api.authoredDatasets().then(setDatasets).catch(() => setDatasets([]));
  };
  useEffect(() => { void refresh(); }, []);

  const openInCockpit = (id: string) =>
    navigate(`/calc-studio/cockpit?dataset=${encodeURIComponent(id)}`);

  const testDataset = async (ds: AuthoredDataset) => {
    setBusyId(ds.id);
    try {
      const res = await api.testAuthoredDataset(ds.id, user.id);
      toast.show(
        res.tested
          ? `Compile + run passed (${res.result.row_count} rows) — ${ds.id} is now tested`
          : `Test did not pass — ${ds.id} stays a draft`,
        res.tested ? 'success' : 'warning',
      );
      refresh();
    } catch (e) {
      toast.show(`Test run failed: ${String(e)}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const submitDataset = async (ds: AuthoredDataset) => {
    setBusyId(ds.id);
    try {
      const next = await api.submitAuthoredDatasetActivation(ds.id, user.id);
      void refreshSignals(); // bell badge / home Command Center / My work
      notifySubmitted({
        recordRef: `dataset:${next.id}`,
        processId: next.process_id ?? undefined,
        label: next.name,
      });
      refresh();
    } catch (e) {
      toast.show(`Submit failed: ${String(e)}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (datasets === null) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  }

  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        The dataset registry — every governed data-prep graph (source → filter → aggregate → join →
        union → derive). Each compiles to one parameterized DuckDB query; an <b>active</b> dataset is
        referenceable as a source in another dataset, as a calc dataset-value, and as an allocation
        pool cost base. The lifecycle is driven here: <b>Test</b> compiles + runs the graph (the
        activation gate); <b>Submit</b> opens a maker-checker item at <b>dataset:&#123;id&#125;</b>.
      </Alert>

      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/calc-studio/cockpit')}>
          New dataset
        </Button>
      </Stack>

      {datasets.length === 0 ? (
        <Paper variant="outlined" sx={{ py: 6, px: 3, textAlign: 'center' }}>
          <GridOnIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>No datasets yet</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            Build one on the cockpit — drag ACDOCA fields onto the canvas, join / filter / aggregate,
            then save the graph as a governed dataset.
          </Typography>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => navigate('/calc-studio/cockpit')}>
            Build one on the cockpit
          </Button>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Dataset</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Sources</TableCell>
                <TableCell>Updated</TableCell>
                <TableCell>Author</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {datasets.map((ds) => {
                const sourceCount = ds.graph.nodes.filter((n) => n.type === 'source').length;
                const updated = ds.updated_at ?? ds.created_at;
                const busy = busyId === ds.id;
                return (
                  <TableRow key={ds.id} hover>
                    <TableCell sx={{ maxWidth: 340 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{ds.name}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                        {ds.id}{ds.process_id ? ` — ${ds.process_id}` : ''} — v{ds.version}
                      </Typography>
                    </TableCell>
                    <TableCell><LifecycleChip status={ds.status} /></TableCell>
                    <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{sourceCount}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {new Date(updated).toLocaleString()}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{ds.created_by}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => openInCockpit(ds.id)}
                        >
                          Open in cockpit
                        </Button>
                        {ds.status === 'draft' && (
                          <Button
                            size="small"
                            disabled={busy}
                            startIcon={busy ? <CircularProgress size={14} /> : undefined}
                            onClick={() => void testDataset(ds)}
                          >
                            Test
                          </Button>
                        )}
                        {ds.status === 'tested' && (
                          <Button
                            size="small"
                            variant="contained"
                            disabled={busy}
                            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
                            onClick={() => void submitDataset(ds)}
                          >
                            Submit for activation
                          </Button>
                        )}
                        {ds.status === 'in_review' && (
                          <Button size="small" onClick={() => navigate('/review')}>
                            Awaiting checker — open review queue
                          </Button>
                        )}
                        <HistoryButton recordRef={`dataset:${ds.id}`} />
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}
