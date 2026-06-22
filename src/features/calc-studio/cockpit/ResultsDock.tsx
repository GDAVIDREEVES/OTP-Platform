import { useMemo, useState } from 'react';
import {
  Alert, Box, Chip, Stack, Tab, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Tabs, Typography,
} from '@mui/material';
import { presentationFor, configSummary, isStageKind } from './nodeMeta';
import { resultText, nodeDelta, deltaText, stageResultText } from './resultText';
import { fmtAmount } from '../allocationLib';
import type { GraphModel } from './useGraphModel';

/** Bottom pane (MC2) — the Alteryx "Results" window. Three views over the last
 *  Run: per-node Values (each node's painted value, with a Base⟷Scenario Δ
 *  column once a scenario is overlaid), the whole-graph Output, and Exceptions
 *  (graph validation errors + per-node evaluation failures). Everything here
 *  comes from the preview the engine produced — nothing is recomputed client
 *  side.
 */

export default function ResultsDock({ model }: { model: GraphModel }) {
  const { nodes, preview, scenarioPreview, stagePreview, datasetPreview, family, validation, running, runError } = model;
  const [view, setView] = useState<'values' | 'output' | 'exceptions'>('values');
  const isAlloc = family === 'alloc';
  const isDataset = family === 'dataset';

  const stageExceptions = stagePreview?.exceptions ?? [];
  const errorCount = (validation && !validation.ok ? validation.errors.length : 0)
    + (preview?.exceptions.length ?? 0)
    + (isAlloc ? stageExceptions.filter((e) => e.severity === 'BLOCK').length : 0);

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

  // Stage rows in canonical pipeline order (MC3) — each stage node + its result.
  const stageRows = useMemo(
    () =>
      nodes
        .filter((n) => isStageKind(n.data.kind))
        .map((n) => ({
          id: n.id,
          kind: n.data.kind,
          summary: configSummary(n.data.kind, n.data.config),
          result: stagePreview?.stages?.[n.id],
        })),
    [nodes, stagePreview]
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

        {/* ---- Values (allocation stage graph) ---- */}
        {view === 'values' && isAlloc && (
          stageRows.length === 0 ? (
            <Empty text="Seed the allocation pipeline and press Run to dry-run each stage here." />
          ) : !stagePreview ? (
            <Empty text="Press Run to dry-run Stages 1-7 in isolation — each stage's result lands here." />
          ) : (
            <TableContainer>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Stage</TableCell>
                    <TableCell>Config</TableCell>
                    <TableCell align="right">Result</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {stageRows.map((r) => (
                    <TableRow key={r.id} hover>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Box sx={{ width: 16, height: 16, borderRadius: '4px', bgcolor: presentationFor(r.kind).accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                            {presentationFor(r.kind).glyph}
                          </Box>
                          <Typography variant="caption" sx={{ fontWeight: 700 }}>{presentationFor(r.kind).label}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{r.summary}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                        {stageResultText(r.kind, r.result) ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )
        )}

        {/* ---- Values (dataset graph) — the tabular preview ---- */}
        {view === 'values' && isDataset && (
          !datasetPreview ? (
            <Empty text="Select a dataset node and press Run — its columns + sample rows + row count land here (Alteryx-style)." />
          ) : (
            <Box>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.5, py: 0.75 }}>
                <Chip size="small" color="primary" variant="outlined"
                  label={`${datasetPreview.row_count.toLocaleString()} rows`} sx={{ height: 20, fontWeight: 700 }} />
                <Chip size="small" variant="outlined"
                  label={`${datasetPreview.columns.length} cols`} sx={{ height: 20 }} />
                {datasetPreview.rows.length < datasetPreview.row_count && (
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    showing first {datasetPreview.rows.length}
                  </Typography>
                )}
              </Stack>
              <TableContainer sx={{ maxHeight: 160 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      {datasetPreview.columns.map((c) => (
                        <TableCell key={c} sx={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>{c}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {datasetPreview.rows.map((row, i) => (
                      <TableRow key={i} hover>
                        {datasetPreview.columns.map((c) => (
                          <TableCell key={c} sx={{ fontFamily: 'monospace', fontSize: 11.5, whiteSpace: 'nowrap' }}>
                            {row[c] == null ? '—' : String(row[c])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )
        )}

        {/* ---- Values (calc graph) ---- */}
        {view === 'values' && !isAlloc && !isDataset && (
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

        {/* ---- Output (allocation stage graph) ---- */}
        {view === 'output' && isAlloc && (
          !stagePreview ? (
            <Empty text="The pool's dry-run summary appears here after a Run." />
          ) : (
            <Box sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={3} alignItems="baseline" sx={{ flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="overline" sx={{ color: 'text.secondary' }}>Recon</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: stagePreview.balanced ? 'success.main' : 'error.main' }}>
                    {stagePreview.balanced ? 'Balanced · zero residual' : 'Break'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="overline" sx={{ color: 'text.secondary' }}>Charged out</Typography>
                  <Typography variant="h6" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                    {stagePreview.total_charged_out != null ? fmtAmount(stagePreview.total_charged_out) : '—'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="overline" sx={{ color: 'text.secondary' }}>Periods</Typography>
                  <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>{(stagePreview.periods ?? []).join(', ') || '—'}</Typography>
                </Box>
              </Stack>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
                Compiled to an authored-pool definition and dry-run through the real Stages 1-7 in
                isolation (PB2) — nothing persisted. The governed allocation is untouched.
              </Typography>
            </Box>
          )
        )}

        {/* ---- Output (dataset graph) ---- */}
        {view === 'output' && isDataset && (
          !datasetPreview ? (
            <Empty text="The dataset's compiled shape (columns + row count) appears here after a Run." />
          ) : (
            <Box sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={3} alignItems="baseline" sx={{ flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="overline" sx={{ color: 'text.secondary' }}>Rows</Typography>
                  <Typography variant="h6" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                    {datasetPreview.row_count.toLocaleString()}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="overline" sx={{ color: 'text.secondary' }}>Columns</Typography>
                  <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
                    {datasetPreview.columns.join(', ') || '—'}
                  </Typography>
                </Box>
              </Stack>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
                Compiled to ONE safe parameterized DuckDB query (column/op/table names from the
                allowlist, values bound) and run through db.q — nothing persisted. DuckDB stays the engine.
              </Typography>
            </Box>
          )
        )}

        {/* ---- Output (calc graph) ---- */}
        {view === 'output' && !isAlloc && !isDataset && (
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
              {isAlloc && stageExceptions.map((e, i) => (
                <Alert key={`s${i}`} severity={e.severity === 'BLOCK' ? 'error' : 'warning'} variant="outlined">
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12.5 }}>
                    {e.rule_id} ({e.severity}): {e.message}
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
