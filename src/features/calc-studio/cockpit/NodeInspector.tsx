import { useMemo } from 'react';
import {
  Box, Button, Chip, Divider, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { presentationFor, isStageKind } from './nodeMeta';
import { resultText } from './resultText';
import StageInspector from './StageInspector';
import type { GraphModel } from './useGraphModel';

/** Right pane (MC2) — INLINE config for the selected node. No modal dialogs
 *  anywhere in the build loop: the same term-picker choices the old Builder
 *  modal offered (governed parameters, the measure allowlist + its grains,
 *  composable system calcs) are rendered here as inline selects that patch the
 *  node's config in place. Editing the canvas IS editing the calc.
 */

export default function NodeInspector({ model }: { model: GraphModel }) {
  const { selectedNode, nodeTypes: cat, updateNodeConfig, removeNode, preview } = model;

  const measureTables = cat?.measures ?? [];
  const grains = cat?.grains ?? ['group', 'entity', 'entity_function'];

  // For a selected measure node: the table's legal grains (so we never offer a
  // grain the engine would reject for that table).
  const selectedMeasureTable = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind !== 'measure') return null;
    const ref = String(selectedNode.data.config.ref ?? '');
    const table = ref.split('.')[0];
    return measureTables.find((t) => t.table === table) ?? null;
  }, [selectedNode, measureTables]);

  const selectedCalc = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind !== 'calc') return null;
    return (cat?.calcs ?? []).find((c) => c.id === selectedNode.data.config.calc_id) ?? null;
  }, [selectedNode, cat]);

  if (!selectedNode) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="overline" sx={{ color: 'text.secondary' }}>Inspector</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
          Select a node to configure it inline — no dialogs. Drag a term from the palette to add one.
        </Typography>
      </Box>
    );
  }

  const { id, data } = selectedNode;
  const kind = data.kind;
  const config = data.config;
  const pres = presentationFor(kind);
  const set = (patch: Record<string, unknown>) => updateNodeConfig(id, patch);
  const nv = preview?.nodes[id];

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 1.5, pb: 1 }}>
        <Box
          sx={{
            width: 24, height: 24, borderRadius: 1, bgcolor: pres.accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
          }}
        >
          {pres.glyph}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{pres.label}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>{id}</Typography>
        </Box>
        <Button
          size="small"
          color="error"
          startIcon={<DeleteOutlineIcon />}
          onClick={() => removeNode(id)}
        >
          Remove
        </Button>
      </Stack>
      <Divider />

      <Box sx={{ flex: 1, overflowY: 'auto', p: 1.5 }}>
        {isStageKind(kind) ? (
          <StageInspector model={model} node={selectedNode} />
        ) : (
        <Stack spacing={1.5}>
          {/* ---- param ---- */}
          {kind === 'param' && (
            <TextField
              select size="small" fullWidth label="Governed parameter"
              value={String(config.key ?? '')}
              onChange={(e) => set({ key: e.target.value })}
            >
              {(cat?.parameters ?? []).map((p) => (
                <MenuItem key={p.key} value={p.key} sx={{ fontFamily: 'monospace', fontSize: 13 }}>
                  {p.key} = {p.value == null ? '—' : typeof p.value === 'object' ? JSON.stringify(p.value) : String(p.value)}
                </MenuItem>
              ))}
              {Boolean(config.key) && !(cat?.parameters ?? []).some((p) => p.key === config.key) && (
                <MenuItem value={String(config.key)}>{String(config.key)}</MenuItem>
              )}
            </TextField>
          )}

          {/* ---- measure ---- */}
          {kind === 'measure' && (
            <>
              <TextField
                select size="small" fullWidth label="Warehouse measure"
                value={String(config.ref ?? '')}
                onChange={(e) => set({ ref: e.target.value })}
              >
                {measureTables.flatMap((t) =>
                  t.measures.map((col) => (
                    <MenuItem key={`${t.table}.${col}`} value={`${t.table}.${col}`} sx={{ fontFamily: 'monospace', fontSize: 13 }}>
                      {t.table}.{col}
                    </MenuItem>
                  ))
                )}
                {Boolean(config.ref) && !measureTables.some((t) => t.measures.some((c) => `${t.table}.${c}` === config.ref)) && (
                  <MenuItem value={String(config.ref)}>{String(config.ref)}</MenuItem>
                )}
              </TextField>
              <TextField
                select size="small" fullWidth label="Grain"
                value={String(config.grain ?? 'group')}
                onChange={(e) => set({ grain: e.target.value })}
                helperText="The grain the measure aggregates to"
              >
                {(selectedMeasureTable ? Object.keys(selectedMeasureTable.grains) : grains).map((g) => (
                  <MenuItem key={g} value={g}>{g}</MenuItem>
                ))}
              </TextField>
              <TextField
                size="small" fullWidth label="Filters (optional)"
                value={String(config.filters ?? '')}
                onChange={(e) => set({ filters: e.target.value || undefined })}
                placeholder="GJAHR=2026,RBUKRS=1000"
                InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
              />
            </>
          )}

          {/* ---- calc ---- */}
          {kind === 'calc' && (
            <>
              <TextField
                select size="small" fullWidth label="Calculation"
                value={String(config.calc_id ?? '')}
                onChange={(e) => set({ calc_id: e.target.value, output_key: '' })}
              >
                {(cat?.calcs ?? []).map((c) => (
                  <MenuItem key={c.id} value={c.id} sx={{ fontSize: 13 }}>
                    {c.id} — {c.name}
                  </MenuItem>
                ))}
                {Boolean(config.calc_id) && !(cat?.calcs ?? []).some((c) => c.id === config.calc_id) && (
                  <MenuItem value={String(config.calc_id)}>{String(config.calc_id)}</MenuItem>
                )}
              </TextField>
              <TextField
                size="small" fullWidth label="Output key"
                value={String(config.output_key ?? '')}
                onChange={(e) => set({ output_key: e.target.value })}
                placeholder={selectedCalc ? `e.g. an output of ${selectedCalc.id}` : 'the calc output to read'}
                helperText="The summary key the calc emits"
                InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
              />
            </>
          )}

          {/* ---- const ---- */}
          {kind === 'const' && (
            <TextField
              size="small" fullWidth label="Constant value"
              value={String(config.value ?? '')}
              onChange={(e) => set({ value: e.target.value })}
              placeholder="e.g. 1.05"
              helperText="Decimal-faithful — no float ever touches the math"
              InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
            />
          )}

          {/* ---- op ---- */}
          {kind === 'op' && (
            <TextField
              select size="small" fullWidth label="Operator"
              value={String(config.op ?? '')}
              onChange={(e) => set({ op: e.target.value })}
              helperText="Wire inputs a and b on the canvas"
            >
              {(cat?.operators ?? ['+', '-', '*', '/']).map((o) => (
                <MenuItem key={o} value={o} sx={{ fontFamily: 'monospace' }}>a {o} b</MenuItem>
              ))}
            </TextField>
          )}

          {/* ---- compare ---- */}
          {kind === 'compare' && (
            <TextField
              select size="small" fullWidth label="Comparator"
              value={String(config.op ?? '')}
              onChange={(e) => set({ op: e.target.value })}
              helperText="Produces a bool — only feeds an if's cond input"
            >
              {(cat?.comparators ?? ['<', '<=', '>', '>=', '==', '!=']).map((o) => (
                <MenuItem key={o} value={o} sx={{ fontFamily: 'monospace' }}>a {o} b</MenuItem>
              ))}
            </TextField>
          )}

          {/* ---- func ---- */}
          {kind === 'func' && (
            <TextField
              select size="small" fullWidth label="Function"
              value={String(config.func ?? '')}
              onChange={(e) => set({ func: e.target.value })}
              helperText="sum/min/max take any inputs (in0,in1,…); abs takes one"
            >
              {(cat?.functions ?? ['sum', 'min', 'max', 'abs']).map((f) => (
                <MenuItem key={f} value={f} sx={{ fontFamily: 'monospace' }}>{f}(…)</MenuItem>
              ))}
            </TextField>
          )}

          {/* ---- if / output: no config, wiring only ---- */}
          {kind === 'if' && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Wire <b>cond</b> (a comparison), <b>then</b> and <b>else</b> on the canvas. No config to set.
            </Typography>
          )}
          {kind === 'output' && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              The terminal result. Wire the node that produces the calculation's value into its single input.
              Exactly one output node per graph.
            </Typography>
          )}

          {/* ---- painted value (after Run) ---- */}
          {kind !== 'output' && nv && (
            <>
              <Divider />
              <Box>
                <Typography variant="overline" sx={{ color: 'text.secondary' }}>Value at this node</Typography>
                {nv.ok ? (
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'primary.main' }}>
                    {resultText(nv.result)} <Chip size="small" label={nv.grain} sx={{ height: 18, fontSize: 10, ml: 0.5 }} />
                  </Typography>
                ) : (
                  <Typography variant="body2" sx={{ color: 'error.main' }}>{nv.error}</Typography>
                )}
                <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace', display: 'block', mt: 0.5, wordBreak: 'break-all' }}>
                  {nv.expression}
                </Typography>
              </Box>
            </>
          )}
        </Stack>
        )}
      </Box>
    </Box>
  );
}
