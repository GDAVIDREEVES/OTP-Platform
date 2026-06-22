import { useMemo, useState } from 'react';
import {
  Alert, Box, Chip, Stack, Tab, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Tabs, Typography,
} from '@mui/material';
import { presentationFor, configSummary } from './nodeMeta';
import { resultText, nodeDelta, deltaText } from './resultText';
import type { GraphModel } from './useGraphModel';

/** Bottom pane (MC2) — the Alteryx "Results" window. Three views over the last
 *  Run: per-node Values (each node's painted value, with a Base⟷Scenario Δ
 *  column once a scenario is overlaid), the whole-graph Output, and Exceptions
 *  (graph validation errors + per-node evaluation failures). Everything here
 *  comes from the preview the engine produced — nothing is recomputed client
 *  side.
 */

export default function ResultsDock({ model }: { model: GraphModel }) {
  const { nodes, preview, scenarioPreview, validation, running, runError } = model;
  const [view, setView] = useState<'values' | 'output' | 'exceptions'>('values');

  const errorCount = (validation && !validation.ok ? validation.errors.length : 0)
    + (preview?.exceptions.length ?? 0);

  const rows = useMemo(
    () =>
      nodes
        .filter((n) => n.data.kind !== 'output')
        .map((n) => {
          const nv = preview?.nodes[n.id];
          const sv = scenarioPreview?.nodes[n.id];
          return {
            id: n.id,
            kind: n.data.kind,
            summary: configSummary(n.data.kind, n.data.config),
            base: nv,
            delta: deltaText(nodeDelta(nv, sv)),
          };
        }),
    [nodes, preview, scenarioPreview]
  );

  const hasScenario = scenarioPreview !== null;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#fff' }}>
      <Stack direction="row" alignItems="center" sx={{ borderBottom: '1px solid', borderColor: 'divider', pr: 1 }}>
        <Tabs value={view} onChange={(_, v) => setView(v)} sx={{ minHeight: 36, flex: 1 }}>
          <Tab value="values" label="Values" sx={{ minHeight: 36, py: 0 }} />
          <Tab value="output" label="Output" sx={{ minHeight: 36, py: 0 }} />
          <Tab
            value="exceptions"
            sx={{ minHeight: 36, py: 0 }}
            label={
              <Stack direction="row" spacing={0.5} alignItems="center">
                <span>Exceptions</span>
                {errorCount > 0 && <Chip size="small" color="error" label={errorCount} sx={{ height: 16, fontSize: 10 }} />}
              </Stack>
            }
          />
        </Tabs>
        {running && <Chip size="small" color="info" label="Running…" sx={{ height: 20 }} />}
        {hasScenario && <Chip size="small" color="warning" variant="outlined" label="Scenario overlay" sx={{ height: 20, ml: 1 }} />}
      </Stack>

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {runError && (
          <Alert severity="error" variant="outlined" sx={{ m: 1 }}>{runError}</Alert>
        )}

        {/* ---- Values ---- */}
        {view === 'values' && (
          rows.length === 0 ? (
            <Empty text="Add nodes and press Run to paint per-node values here." />
          ) : !preview ? (
            <Empty text="Press Run to evaluate — each node's value lands in this table (Alteryx-style)." />
          ) : (
            <TableContainer>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Node</TableCell>
                    <TableCell>Term</TableCell>
                    <TableCell align="right">Value (exact)</TableCell>
                    {hasScenario && <TableCell align="right">Scenario Δ</TableCell>}
                    <TableCell>Grain</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} hover>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Box sx={{ width: 16, height: 16, borderRadius: '4px', bgcolor: presentationFor(r.kind).accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                            {presentationFor(r.kind).glyph}
                          </Box>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{r.id}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{r.summary}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                        {r.base ? (r.base.ok ? resultText(r.base.result) : <Typography variant="caption" color="error">err</Typography>) : '—'}
                      </TableCell>
                      {hasScenario && (
                        <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: 700, color: r.delta?.startsWith('+') ? 'success.main' : r.delta?.startsWith('−') ? 'error.main' : 'text.secondary' }}>
                          {r.delta ?? '—'}
                        </TableCell>
                      )}
                      <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>{r.base?.ok ? r.base.grain : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )
        )}

        {/* ---- Output ---- */}
        {view === 'output' && (
          !preview ? (
            <Empty text="The whole-graph result appears here after a Run." />
          ) : (
            <Box sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={2} alignItems="baseline" sx={{ flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="overline" sx={{ color: 'text.secondary' }}>Base result — {preview.grain} grain</Typography>
                  <Typography variant="h6" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{resultText(preview.result)}</Typography>
                </Box>
                {scenarioPreview && (
                  <Box>
                    <Typography variant="overline" sx={{ color: 'warning.main' }}>Scenario result</Typography>
                    <Typography variant="h6" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'warning.dark' }}>
                      {resultText(scenarioPreview.result)}
                    </Typography>
                  </Box>
                )}
              </Stack>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace', display: 'block', mt: 1, p: 1, bgcolor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 1, wordBreak: 'break-all' }}>
                compiled expression: {preview.expression}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                Compiled to a calc/expr.py expression and evaluated by the existing engine — nothing persisted.
              </Typography>
            </Box>
          )
        )}

        {/* ---- Exceptions ---- */}
        {view === 'exceptions' && (
          errorCount === 0 ? (
            <Empty text="No exceptions — the graph is structurally valid and every node evaluated." />
          ) : (
            <Stack spacing={1} sx={{ p: 1.5 }}>
              {validation && !validation.ok && validation.errors.map((e, i) => (
                <Alert key={`v${i}`} severity="warning" variant="outlined">
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12.5 }}>
                    {e.node_id ? `${e.node_id}: ` : ''}{e.message}
                  </Typography>
                </Alert>
              ))}
              {(preview?.exceptions ?? []).map((e, i) => (
                <Alert key={`e${i}`} severity="error" variant="outlined">
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12.5 }}>
                    {e.node_id}: {e.message}
                  </Typography>
                </Alert>
              ))}
            </Stack>
          )
        )}
      </Box>
    </Box>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{text}</Typography>
    </Box>
  );
}
