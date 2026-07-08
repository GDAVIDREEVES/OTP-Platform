import { useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Box } from '@mui/material';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import EmptyState from '@/shared/components/EmptyState';
import CockpitNode from './CockpitNode';
import { CanvasContext } from './canvasContext';
import {
  presentationForFamily,
  outputKindFor,
  inputHandlesFor,
  stageInputsFor,
  stageHasFlowOut,
  isStageKind,
  isDatasetKind,
  datasetInputsFor,
  STAGE_ORDER,
} from './nodeMeta';
import type { GraphModel, RFNode } from './useGraphModel';

/** A palette drag payload (set in NodePalette.onDragStart, read on drop).
 *
 *  The default ``node`` intent drops a backend node (kind + seed config). DS5
 *  adds two dataset-specific intents that are distinct from a plain node so the
 *  Canvas can build the right thing on drop (a field/value can seed a small
 *  subgraph OR augment an existing dataset node it lands on):
 *  - ``datasetField`` — an ACDOCA field {table, name, role}
 *  - ``datasetValue`` — a dimension value {table, column, value} (bound param) */
export type DragPayload =
  | { intent?: 'node'; kind: string; config: Record<string, unknown> }
  | { intent: 'datasetField'; field: { table: string; name: string; role: 'dimension' | 'measure' } }
  | { intent: 'datasetValue'; value: { table: string; column: string; value: string | number } };
export const DRAG_MIME = 'application/x-otp-cockpit-node';

const NODE_COMPONENTS = { cockpit: CockpitNode };

/** The center pane — React Flow with the typed custom node, a typed
 *  ``isValidConnection`` guard (kind compatibility + acyclic + single-input),
 *  pan/zoom/minimap, and palette drag-and-drop (one gesture, no dialog). */
function CanvasInner({ model, onOpenExisting }: { model: GraphModel; onOpenExisting?: () => void }) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  const {
    nodeTypes: catalogue,
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    dropField,
    dropValue,
    setSelectedId,
    preview,
    scenarioPreview,
    stagePreview,
    family,
    validation,
  } = model;

  // Stamp func nodes with their wired-input count so the variadic handle list
  // can show one open slot ahead of what's connected.
  const wiredByNode = useMemo(() => {
    const m: Record<string, number> = {};
    edges.forEach((e) => { m[e.target] = (m[e.target] ?? 0) + 1; });
    return m;
  }, [edges]);

  const renderNodes: RFNode[] = useMemo(
    () =>
      nodes.map((n) =>
        n.data.kind === 'func'
          ? { ...n, data: { ...n.data, _wired: wiredByNode[n.id] ?? 0 } }
          : n
      ),
    [nodes, wiredByNode]
  );

  const errorNodeIds = useMemo(() => {
    const s = new Set<string>();
    (validation?.errors ?? []).forEach((e) => { if (e.node_id) s.add(e.node_id); });
    return s;
  }, [validation]);

  // ---- typed connection guard ----
  // Reject a wire that (a) crosses kinds (a bool may only feed an if.cond
  // input), (b) lands on an already-wired input, or (c) would create a cycle.
  const nodeById = useMemo(() => {
    const m: Record<string, RFNode> = {};
    nodes.forEach((n) => { m[n.id] = n; });
    return m;
  }, [nodes]);

  const isValidConnection: IsValidConnection<Edge> = useCallback(
    (conn: Connection | Edge) => {
      const { source, target, sourceHandle, targetHandle } = conn;
      if (!source || !target) return false;
      if (source === target) return false; // no self-loops
      const src = nodeById[source];
      const tgt = nodeById[target];
      if (!src || !tgt) return false;

      // ---- dataset RELATION rules (DS3) ----
      // A dataset relation handle only connects to another dataset relation
      // handle: the relation family is kept distinct from value/bool/flow. A
      // ``source`` is family-ambiguous by kind alone, so we resolve it from the
      // canvas family (the two families never coexist on one canvas).
      const srcDataset = isDatasetKind(src.data.kind)
        && (family === 'dataset' || src.data.kind !== 'source'
            || typeof src.data.config?.table === 'string');
      const tgtDataset = isDatasetKind(tgt.data.kind)
        && (family === 'dataset' || tgt.data.kind !== 'source');
      if (srcDataset || tgtDataset) {
        if (!(srcDataset && tgtDataset)) return false; // no cross-family wire
        // The target's relation input handles (in / left / right) accept the
        // relation flowing out of any upstream dataset node.
        const inputs = datasetInputsFor(tgt.data.kind).map((h) => h.handle);
        if (!inputs.includes(targetHandle ?? '')) return false;
      } else {

      const srcStage = isStageKind(src.data.kind);
      const tgtStage = isStageKind(tgt.data.kind);

      // ---- allocation stage-order rules (MC3) ----
      if (tgtStage) {
        if (targetHandle === 'in') {
          // The pipeline ``in`` accepts ONLY the immediately-preceding stage's
          // pipeline ``out`` — this is what enforces the canonical order on the
          // canvas; an out-of-order or cross-family wire is rejected outright.
          if (!srcStage || !stageHasFlowOut(src.data.kind, catalogue)) return false;
          const ti = STAGE_ORDER.indexOf(tgt.data.kind as (typeof STAGE_ORDER)[number]);
          const si = STAGE_ORDER.indexOf(src.data.kind as (typeof STAGE_ORDER)[number]);
          if (ti <= 0 || si !== ti - 1) return false;
        } else {
          // A numeric (value) input is fed by a calc-value subgraph only.
          const numeric = stageInputsFor(tgt.data.kind, catalogue)
            .filter((h) => h.kind === 'value')
            .map((h) => h.handle);
          if (!numeric.includes(targetHandle ?? '')) return false;
          if (srcStage) return false;
          if (outputKindFor(src.data.kind, catalogue) !== 'value') return false;
        }
      } else if (srcStage) {
        // A stage ``out`` can only feed another stage's ``in`` (handled above);
        // it never feeds a calc node.
        return false;
      } else {
        // ---- calc-to-calc kind compatibility (MC2, unchanged) ----
        const srcOut = outputKindFor(src.data.kind, catalogue);
        const tgtInputs = inputHandlesFor(tgt.data.kind, catalogue, 99);
        const want = tgtInputs.find((h) => h.handle === targetHandle)?.kind;
        if (want != null && srcOut != null && want !== srcOut) return false;
      }
      } // end calc/alloc branch (the dataset branch returned/fell through above)

      // Acyclic: walk the existing dependency edges from `target`; if we can
      // already reach `source`, this new edge would close a cycle.
      const adj: Record<string, string[]> = {};
      edges.forEach((e) => { (adj[e.source] ??= []).push(e.target); });
      const seen = new Set<string>();
      const stack = [target];
      while (stack.length) {
        const cur = stack.pop() as string;
        if (cur === source) return false;
        if (seen.has(cur)) continue;
        seen.add(cur);
        (adj[cur] ?? []).forEach((nx) => stack.push(nx));
      }
      void sourceHandle;
      return true;
    },
    [nodeById, edges, catalogue, family]
  );

  // ---- palette drop ----
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(DRAG_MIME);
      if (!raw) return;
      let payload: DragPayload;
      try {
        payload = JSON.parse(raw) as DragPayload;
      } catch {
        return;
      }
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      // Did the drop land on an existing node? React Flow stamps the node id on
      // the ``.react-flow__node`` wrapper as ``data-id`` — a field/value dropped
      // onto a dataset node augments it (no new node) rather than seeding a fresh
      // subgraph. A plain node drop ignores the target (always a new node).
      const onNode = (e.target as HTMLElement | null)
        ?.closest?.('.react-flow__node') as HTMLElement | null;
      const targetId = onNode?.dataset?.id ?? null;

      if (payload.intent === 'datasetField') {
        dropField(payload.field, targetId, position);
      } else if (payload.intent === 'datasetValue') {
        dropValue(payload.value, targetId, position);
      } else {
        addNode(payload.kind, payload.config, position);
      }
    },
    [screenToFlowPosition, addNode, dropField, dropValue]
  );

  return (
    <CanvasContext.Provider value={{ catalogue, preview, scenarioPreview, stagePreview, family, errorNodeIds }}>
      <Box
        ref={wrapperRef}
        sx={{ width: '100%', height: '100%', position: 'relative' }}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <ReactFlow
          nodes={renderNodes}
          edges={edges}
          nodeTypes={NODE_COMPONENTS}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          onPaneClick={() => setSelectedId(null)}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.75}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ animated: false, style: { stroke: '#94A3B8', strokeWidth: 2 } }}
        >
          <Background gap={18} color="#E2E8F0" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => presentationForFamily((n.data as { kind?: string })?.kind ?? '', family).accent}
            maskColor="rgba(241,245,249,0.6)"
            style={{ background: '#fff', border: '1px solid #E2E8F0' }}
          />
        </ReactFlow>

        {/* Zero-node overlay (POL-09) — teaches the two ways to start a build.
            pointer-events pass through so a drag still lands on the canvas below;
            only the CTA button is clickable. */}
        {nodes.length === 0 && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              '& button': { pointerEvents: 'auto' },
            }}
          >
            <EmptyState
              icon={<AccountTreeOutlinedIcon />}
              title="Start a build on the canvas"
              body="Drag a parameter, measure, source or stage from the palette on the left — one gesture, no
                dialog — or open an existing calculation, pool or dataset to edit."
              cta={onOpenExisting ? { label: 'Open an existing build', onClick: onOpenExisting } : undefined}
            />
          </Box>
        )}
      </Box>
    </CanvasContext.Provider>
  );
}

export default function Canvas({ model, onOpenExisting }: { model: GraphModel; onOpenExisting?: () => void }) {
  return (
    <ReactFlowProvider>
      <CanvasInner model={model} onOpenExisting={onOpenExisting} />
    </ReactFlowProvider>
  );
}
