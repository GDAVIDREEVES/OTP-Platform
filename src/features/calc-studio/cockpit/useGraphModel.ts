import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import { api } from '@/shared/api/client';
import type {
  CockpitNodeTypes,
  CockpitGraph,
  CockpitGraphValidation,
  CockpitGraphPreview,
} from '@/shared/api/types';

/** The cockpit graph model (MC2) — React Flow state ⟷ the backend graph API.
 *
 *  This hook owns the editable canvas: the React Flow node/edge arrays, the
 *  palette catalogue, the live validation report, and the preview values
 *  painted onto each node. It (de)serialises between React Flow's shape
 *  ({id,type:'cockpit',data:{kind,config},position} + edges with handles) and
 *  the backend graph JSON ({id,type,config,position} + edges) so the canvas is
 *  a pure visual layer — the backend compiles a calc subgraph to a calc/expr.py
 *  expression and reuses the unchanged eval/trace/scenario/lifecycle.
 *
 *  No new evaluation lives here: Run/Preview calls POST /api/calc-graph/preview
 *  (optionally under a scenario overlay) and paints the returned per-node
 *  values; Save/Test/Submit route through the existing user-calc lifecycle.
 */

/** React Flow node data we carry on every cockpit node. */
export interface CockpitNodeData {
  /** The backend node type ('param' | 'measure' | … | 'output'). */
  kind: string;
  /** The node's config object (param key, op symbol, …) — edited inline. */
  config: Record<string, unknown>;
  [key: string]: unknown;
}

export type RFNode = Node<CockpitNodeData>;
export type RFEdge = Edge;

let _seq = 0;
/** A fresh, collision-proof node id (monotone per session). */
export function nextNodeId(): string {
  _seq += 1;
  return `n${Date.now().toString(36)}_${_seq}`;
}

/** React Flow nodes/edges -> backend graph JSON. */
export function toGraph(nodes: RFNode[], edges: RFEdge[]): CockpitGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.kind,
      config: n.data.config ?? {},
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    })),
    edges: edges.map((e) => ({
      source: e.source,
      sourceHandle: e.sourceHandle ?? 'out',
      target: e.target,
      targetHandle: e.targetHandle ?? 'in',
    })),
  };
}

/** Backend graph JSON -> React Flow nodes/edges (every node renders via the
 *  single 'cockpit' custom node type; the backend node type rides in data). */
export function fromGraph(graph: CockpitGraph): { nodes: RFNode[]; edges: RFEdge[] } {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: 'cockpit',
      position: n.position ?? { x: 0, y: 0 },
      data: { kind: n.type, config: n.config ?? {} },
    })),
    edges: graph.edges.map((e, i) => ({
      id: `e${i}_${e.source}_${e.target}_${e.targetHandle}`,
      source: e.source,
      sourceHandle: e.sourceHandle ?? 'out',
      target: e.target,
      targetHandle: e.targetHandle ?? 'in',
    })),
  };
}

export function useGraphModel() {
  const [nodeTypes, setNodeTypes] = useState<CockpitNodeTypes | null>(null);
  const [nodes, setNodes] = useState<RFNode[]>([]);
  const [edges, setEdges] = useState<RFEdge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [validation, setValidation] = useState<CockpitGraphValidation | null>(null);
  const [preview, setPreview] = useState<CockpitGraphPreview | null>(null);
  const [scenarioPreview, setScenarioPreview] = useState<CockpitGraphPreview | null>(null);

  // Palette catalogue (node-type schemas + live params/measures/calcs).
  const reloadNodeTypes = useCallback(() => {
    api.cockpitNodeTypes().then(setNodeTypes).catch(() => setNodeTypes(null));
  }, []);
  useEffect(() => { reloadNodeTypes(); }, [reloadNodeTypes]);

  // ---- React Flow change handlers ----
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds) as RFNode[]),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );
  const onConnect = useCallback((conn: Connection) => {
    setEdges((eds) => {
      // A target input handle takes exactly one edge — drop any prior wire into
      // it so reconnecting replaces rather than doubling (the backend rejects a
      // doubly-wired handle; the canvas should never let you build one).
      const cleaned = eds.filter(
        (e) => !(e.target === conn.target && e.targetHandle === conn.targetHandle)
      );
      return addEdge({ ...conn }, cleaned);
    });
  }, []);

  /** Add a node at a canvas position (one gesture from the palette — no dialog).
   *  Returns the new id so the caller can select + inspect it immediately. */
  const addNode = useCallback(
    (kind: string, config: Record<string, unknown>, position: { x: number; y: number }) => {
      const id = nextNodeId();
      setNodes((nds) =>
        nds.concat({ id, type: 'cockpit', position, data: { kind, config } })
      );
      setSelectedId(id);
      // A structural edit invalidates the painted values until the next Run.
      setPreview(null);
      setScenarioPreview(null);
      return id;
    },
    []
  );

  /** Patch the selected node's config inline (the inspector). */
  const updateNodeConfig = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } } }
            : n
        )
      );
      setPreview(null);
      setScenarioPreview(null);
    },
    []
  );

  const removeNode = useCallback((id: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    setSelectedId((sel) => (sel === id ? null : sel));
    setPreview(null);
    setScenarioPreview(null);
  }, []);

  /** Replace the whole graph (loading an existing calc's graph for round-trip). */
  const loadGraph = useCallback((graph: CockpitGraph) => {
    const { nodes: ns, edges: es } = fromGraph(graph);
    setNodes(ns);
    setEdges(es);
    setSelectedId(null);
    setPreview(null);
    setScenarioPreview(null);
  }, []);

  const clearGraph = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setSelectedId(null);
    setValidation(null);
    setPreview(null);
    setScenarioPreview(null);
  }, []);

  // ---- live validation (debounced) ----
  const graphSig = JSON.stringify(toGraph(nodes, edges));
  useEffect(() => {
    if (nodes.length === 0) {
      setValidation(null);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .validateGraph(JSON.parse(graphSig) as CockpitGraph)
        .then((v) => { if (!cancelled) setValidation(v); })
        .catch(() => { if (!cancelled) setValidation(null); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [graphSig, nodes.length]);

  // ---- preview (Run/Preview) ----
  const runningRef = useRef(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  /** Run/Preview — paint base values; if ``overrides`` are supplied also fetch
   *  the scenario pass so the dock + nodes can show the Δ. One always-visible
   *  action (the cockpit's Run button). */
  const runPreview = useCallback(
    async (overrides?: Record<string, unknown>) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setRunning(true);
      setRunError(null);
      const graph = toGraph(nodes, edges);
      try {
        const base = await api.previewGraph(graph);
        setPreview(base);
        if (overrides && Object.keys(overrides).length) {
          const scen = await api.previewGraph(graph, overrides);
          setScenarioPreview(scen);
        } else {
          setScenarioPreview(null);
        }
      } catch (e) {
        setRunError(String(e));
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
    },
    [nodes, edges]
  );

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;

  return {
    nodeTypes,
    reloadNodeTypes,
    nodes,
    edges,
    selectedId,
    selectedNode,
    setSelectedId,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    updateNodeConfig,
    removeNode,
    loadGraph,
    clearGraph,
    validation,
    preview,
    scenarioPreview,
    running,
    runError,
    runPreview,
    toGraph: () => toGraph(nodes, edges),
  };
}

export type GraphModel = ReturnType<typeof useGraphModel>;
