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
import CockpitNode from './CockpitNode';
import { CanvasContext } from './canvasContext';
import {
  presentationFor,
  outputKindFor,
  inputHandlesFor,
  stageInputsFor,
  stageHasFlowOut,
  isStageKind,
  STAGE_ORDER,
} from './nodeMeta';
import type { GraphModel, RFNode } from './useGraphModel';

/** A palette drag payload (set in NodePalette.onDragStart, read on drop). */
export interface DragPayload {
  kind: string;
  config: Record<string, unknown>;
}
export const DRAG_MIME = 'application/x-otp-cockpit-node';

const NODE_COMPONENTS = { cockpit: CockpitNode };

/** The center pane — React Flow with the typed custom node, a typed
 *  ``isValidConnection`` guard (kind compatibility + acyclic + single-input),
 *  pan/zoom/minimap, and palette drag-and-drop (one gesture, no dialog). */
function CanvasInner({ model }: { model: GraphModel }) {
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
    setSelectedId,
    preview,
    scenarioPreview,
    stagePreview,
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
    [nodeById, edges, catalogue]
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
      addNode(payload.kind, payload.config, position);
    },
    [screenToFlowPosition, addNode]
  );

  return (
    <CanvasContext.Provider value={{ catalogue, preview, scenarioPreview, stagePreview, errorNodeIds }}>
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
            nodeColor={(n) => presentationFor((n.data as { kind?: string })?.kind ?? '').accent}
            maskColor="rgba(241,245,249,0.6)"
            style={{ background: '#fff', border: '1px solid #E2E8F0' }}
          />
        </ReactFlow>
      </Box>
    </CanvasContext.Provider>
  );
}

export default function Canvas({ model }: { model: GraphModel }) {
  return (
    <ReactFlowProvider>
      <CanvasInner model={model} />
    </ReactFlowProvider>
  );
}
