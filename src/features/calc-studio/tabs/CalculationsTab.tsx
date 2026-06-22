import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { api } from '@/shared/api/client';
import type { CalcDef, UserCalc, UserCalcStatus } from '@/shared/api/types';
import CalcDetailDrawer from '../components/CalcDetailDrawer';

/** Calculations — the registry of every computed endpoint the platform serves
 *  (seeds/calculations/calculations.v1.json) PLUS the user-authored
 *  expressions (W4): "New calculation" opens the COCKPIT (Phase 7 — the modal
 *  Builder is retired from the authoring path; its term-picker logic now lives
 *  inline in the cockpit inspector); drafts/tested/in-review calcs live in the
 *  authoring pipeline until a DIFFERENT reviewer activates them, at which point
 *  they list in the registry with a user-defined chip. Row click opens the
 *  detail drawer: definition, resolved inputs, run history and "Run now". A
 *  `?calc={id}` query param auto-opens the drawer (the Lineage graph deep-links
 *  here). No figures are invented here — every row is read from GET /api/calcs
 *  / GET /api/user-calcs. */

const UCALC_CHIP: Record<UserCalcStatus, { label: string; color: 'default' | 'info' | 'warning' | 'success' }> = {
  draft: { label: 'draft', color: 'default' },
  tested: { label: 'tested', color: 'info' },
  in_review: { label: 'in review', color: 'warning' },
  active: { label: 'active', color: 'success' },
};

export default function CalculationsTab() {
  const navigate = useNavigate();
  const [defs, setDefs] = useState<CalcDef[] | null>(null);
  const [userCalcs, setUserCalcs] = useState<UserCalc[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const refresh = () => {
    api.calcs().then(setDefs).catch(() => setDefs([]));
    api.userCalcs().then(setUserCalcs).catch(() => setUserCalcs([]));
  };
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

  if (defs === null || userCalcs === null) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  }

  // Active user calcs already list in the registry (GET /api/calcs);
  // everything earlier in the lifecycle is the authoring pipeline.
  const pipeline = userCalcs.filter((u) => u.status !== 'active');

  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        The calculation registry — every computed endpoint the platform serves, with its formula, the
        governed inputs it reads, and its run history. Click a row to inspect the definition and run it
        now; each run hash-chains a <b>run</b> event at <b>calc:&#123;id&#125;</b> (user-defined calcs
        at <b>ucalc:&#123;id&#125;</b>).
      </Alert>

      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/calc-studio/cockpit')}>
          New calculation
        </Button>
      </Stack>

      {pipeline.length > 0 && (
        <Box>
          <Typography variant="overline" sx={{ color: 'text.secondary' }}>
            Authoring pipeline — drafts, tested &amp; in review
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Calculation</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Version</TableCell>
                  <TableCell>Grain</TableCell>
                  <TableCell>Author</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pipeline.map((u) => {
                  const chip = UCALC_CHIP[u.status];
                  return (
                    <TableRow key={u.id} hover>
                      <TableCell sx={{ maxWidth: 320 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{u.name}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }} noWrap>
                          {u.id} — {u.expression}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" color={chip.color} label={chip.label} sx={{ height: 20, fontSize: 11 }} />
                      </TableCell>
                      <TableCell>v{u.version}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{u.output_grain}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{u.created_by}</TableCell>
                      <TableCell align="right">
                        {u.status === 'in_review' ? (
                          <Button size="small" onClick={() => navigate('/review')}>
                            Awaiting checker — open review queue
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => navigate(`/calc-studio/cockpit?calc=${encodeURIComponent(u.id)}`)}
                          >
                            Open in cockpit
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Calculation</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Kind</TableCell>
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
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Chip
                      size="small"
                      variant="outlined"
                      color={d.kind === 'user-defined' ? 'secondary' : 'default'}
                      label={d.kind}
                      sx={{ height: 20, fontSize: 11 }}
                    />
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                      v{d.version}
                    </Typography>
                  </Stack>
                </TableCell>
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
