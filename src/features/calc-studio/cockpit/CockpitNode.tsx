import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Box, Stack, Typography } from '@mui/material';
import type { CockpitNodeData } from './useGraphModel';
import { useCanvasCtx } from './canvasContext';
import {
  presentationForFamily,
  configSummary,
  datasetSourceSummary,
  inputHandlesFor,
  outputKindFor,
  handleColor,
  stageInputsFor,
  stageHasFlowOut,
  isStageKind,
  isDatasetKind,
  datasetInputsFor,
  type HandleKind,
} from './nodeMeta';
import { nodeValueText, nodeDelta, deltaText, stageResultText } from './resultText';

/** The single custom React Flow node for the cockpit canvas (MC2). Every graph
 *  node renders through this component; the backend node type rides in
 *  ``data.kind``. It draws TYPED input/output handles (indigo = value, amber =
 *  bool) positioned from the backend catalogue, an inline config summary, and —
 *  after a Run — the painted per-node value plus a Base⟷Scenario Δ badge. The
 *  handle ``id`` equals the backend handle name so an edge's
 *  source/targetHandle serialises straight back to the graph JSON.
 */

function CockpitNodeInner({ id, data, selected }: NodeProps) {
  const { kind, config } = data as CockpitNodeData;
  const { catalogue, preview, scenarioPreview, stagePreview, family, errorNodeIds } = useCanvasCtx();
  const pres = presentationForFamily(kind, family);
  // A node belongs to the DATASET family when the canvas family is dataset and
  // its kind is a data-prep kind (disambiguates the shared ``source``).
  const dataset = family === 'dataset' && isDatasetKind(kind);
  const stage = !dataset && isStageKind(kind);

  // A func node is variadic: the Canvas stamps data._wired = how many edges
  // already land on it, so the handle list shows every wired slot plus one open
  // slot to drop the next wire into.
  const wired = typeof (data as Record<string, unknown>)._wired === 'number'
    ? ((data as Record<string, unknown>)._wired as number)
    : 0;
  // Dataset nodes draw RELATION handles (in / left / right) + a relation out
  // (every node but a source has inputs; all but a terminal emit a relation).
  // Stage nodes draw a pipeline ``in`` (flow) + numeric (value) inputs and a
  // pipeline ``out`` (except recon); calc nodes draw their typed value/bool ports.
  const inputs: { handle: string; kind: HandleKind }[] = dataset
    ? datasetInputsFor(kind)
    : stage
      ? stageInputsFor(kind, catalogue)
      : inputHandlesFor(kind, catalogue, wired);
  const outKind: HandleKind = dataset
    ? 'relation'
    : stage
      ? (stageHasFlowOut(kind, catalogue) ? 'flow' : null)
      : outputKindFor(kind, catalogue);

  const nv = !dataset && !stage ? preview?.nodes[id] : undefined;
  const sv = stagePreview?.stages?.[id];
  const valueText = dataset ? null : stage ? stageResultText(kind, sv) : nodeValueText(nv);
  const failed = !stage && !dataset && nv && !nv.ok;
  const flagged = errorNodeIds.has(id);

  const delta = stage || dataset ? null : deltaText(nodeDelta(nv, scenarioPreview?.nodes[id]));

  // Stack input handles down the left edge, evenly spaced.
  const rowH = 100 / (inputs.length + 1);

  return (
    <Box
      sx={{
        minWidth: 168,
        maxWidth: 240,
        borderRadius: 1.5,
        border: '2px solid',
        borderColor: flagged || failed ? 'error.main' : selected ? 'primary.main' : '#CBD5E1',
        bgcolor: '#FFFFFF',
        boxShadow: selected ? 4 : 1,
        position: 'relative',
        overflow: 'visible',
      }}
    >
      {/* Input handles (left) */}
      {inputs.map((h, i) => (
        <Handle
          key={h.handle}
          type="target"
          position={Position.Left}
          id={h.handle}
          style={{
            top: `${rowH * (i + 1)}%`,
            width: 11,
            height: 11,
            background: handleColor(h.kind),
            border: '2px solid #fff',
          }}
        />
      ))}
      {/* Output handle (right) — omitted for the terminal output node. */}
      {outKind !== null && (
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          style={{
            top: '50%',
            width: 11,
            height: 11,
            background: handleColor(outKind),
            border: '2px solid #fff',
          }}
        />
      )}

      {/* Header */}
      <Stack
        direction="row"
        spacing={0.75}
        alignItems="center"
        sx={{ px: 1, py: 0.5, bgcolor: pres.accent, borderTopLeftRadius: 5, borderTopRightRadius: 5 }}
      >
        <Box
          sx={{
            width: 20, height: 20, borderRadius: '50%', bgcolor: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, color: '#334155', flexShrink: 0,
          }}
        >
          {pres.glyph}
        </Box>
        <Typography variant="caption" sx={{ fontWeight: 700, color: '#334155', flex: 1 }} noWrap>
          {pres.label}
        </Typography>
      </Stack>

      {/* Body — config summary + painted value */}
      <Box sx={{ px: 1, py: 0.75 }}>
        <Typography
          variant="caption"
          sx={{ fontFamily: 'monospace', fontSize: 11.5, color: '#475569', display: 'block', wordBreak: 'break-word' }}
        >
          {dataset && kind === 'source' ? datasetSourceSummary(config) : configSummary(kind, config)}
        </Typography>
        {kind !== 'output' && valueText !== null && (
          <Typography
            variant="caption"
            sx={{
              fontFamily: 'monospace', fontWeight: 700, fontSize: 12, display: 'block', mt: 0.5,
              color: stage && kind === 'recon' && !sv?.balanced ? 'error.main' : 'primary.main',
            }}
            noWrap
            title={valueText}
          >
            {stage ? '' : '= '}{valueText}
          </Typography>
        )}
        {failed && (
          <Typography variant="caption" sx={{ color: 'error.main', fontSize: 10.5, display: 'block', mt: 0.5 }}>
            {nv?.error}
          </Typography>
        )}
        {delta && (
          <Typography
            variant="caption"
            sx={{
              fontFamily: 'monospace', fontWeight: 700, fontSize: 11,
              color: delta.startsWith('+') ? 'success.main' : delta.startsWith('−') ? 'error.main' : 'text.secondary',
              display: 'block',
            }}
            title="scenario − base"
          >
            Δ {delta}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

export default memo(CockpitNodeInner);
