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
  StageGraphPreview,
} from '@/shared/api/types';
import { familyOfNodes } from './nodeMeta';
import type { DatasetPreview } from '@/shared/api/types';

/** Which family the current canvas graph belongs to. A graph with any allocation
 *  stage node is an ``alloc`` stage graph; one with any data-prep node is a
 *  ``dataset`` graph (DS3); otherwise (with nodes) it's a ``calc`` graph; empty
 *  is ``empty``. The three families never mix on one canvas (the connection
 *  guard + backend validation reject cross-wires). */
export type GraphFamily = 'calc' | 'alloc' | 'dataset' | 'empty';

export function graphFamilyOf(
  nodes: { data: { kind: string; config?: Record<string, unknown> } }[]
): GraphFamily {
  return familyOfNodes(nodes);
}

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
  const [stagePreview, setStagePreview] = useState<StageGraphPreview | null>(null);
  const [datasetPreview, setDatasetPreview] = useState<DatasetPreview | null>(null);

  const family = graphFamilyOf(nodes);

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
      setStagePreview(null);
      setDatasetPreview(null);
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
      setStagePreview(null);
      setDatasetPreview(null);
    },
    []
  );

  const removeNode = useCallback((id: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    setSelectedId((sel) => (sel === id ? null : sel));
    setPreview(null);
    setScenarioPreview(null);
    setStagePreview(null);
    setDatasetPreview(null);
  }, []);

  /** Replace the whole graph (loading an existing calc's graph for round-trip). */
  const loadGraph = useCallback((graph: CockpitGraph) => {
    const { nodes: ns, edges: es } = fromGraph(graph);
    setNodes(ns);
    setEdges(es);
    setSelectedId(null);
    setPreview(null);
    setScenarioPreview(null);
    setStagePreview(null);
    setDatasetPreview(null);
  }, []);

  const clearGraph = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setSelectedId(null);
    setValidation(null);
    setPreview(null);
    setScenarioPreview(null);
    setStagePreview(null);
    setDatasetPreview(null);
  }, []);

  /** Seed an empty canvas with the full allocation stage pipeline (MC3) —
   *  source→pool→benefit_test→allocate→markup→charge→recon, pre-wired in
   *  canonical order and auto-laid-out left→right. One gesture replaces a fiddly
   *  seven-drag chain; the user then configures each stage inline. */
  const seedStageChain = useCallback(() => {
    const ORDER = [
      'source', 'pool', 'benefit_test', 'allocate', 'markup', 'charge', 'recon',
    ];
    const ids = ORDER.map(() => nextNodeId());
    const newNodes: RFNode[] = ORDER.map((kind, i) => ({
      id: ids[i],
      type: 'cockpit',
      position: { x: i * 210, y: 140 },
      data: { kind, config: {} },
    }));
    const newEdges: RFEdge[] = ORDER.slice(1).map((_, i) => ({
      id: `e_stage_${ids[i]}_${ids[i + 1]}`,
      source: ids[i],
      sourceHandle: 'out',
      target: ids[i + 1],
      targetHandle: 'in',
    }));
    setNodes(newNodes);
    setEdges(newEdges);
    setSelectedId(ids[0]);
    setPreview(null);
    setScenarioPreview(null);
    setStagePreview(null);
    setDatasetPreview(null);
  }, []);

  // ---- live validation (debounced) ----
  // A DATASET graph validates against the dataset allowlist compiler
  // (/api/dataset/validate); calc + alloc graphs validate against the
  // calc-graph validator. The validation shape is normalised to
  // CockpitGraphValidation either way (output_id is null for a dataset).
  const graphSig = JSON.stringify(toGraph(nodes, edges));
  const famSig = graphFamilyOf(nodes);
  useEffect(() => {
    if (nodes.length === 0) {
      setValidation(null);
      return undefined;
    }
    let cancelled = false;
    const g = JSON.parse(graphSig) as CockpitGraph;
    const t = setTimeout(() => {
      const p = famSig === 'dataset'
        ? api.validateDataset(g).then((v) => ({
            ok: v.ok, errors: v.errors, output_id: null,
          }))
        : api.validateGraph(g);
      p
        .then((v) => { if (!cancelled) setValidation(v); })
        .catch(() => { if (!cancelled) setValidation(null); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [graphSig, famSig, nodes.length]);

  // ---- preview (Run/Preview) ----
  const runningRef = useRef(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  /** Build the dataset subgraph rooted at ``rootId`` (every upstream relation
   *  node reachable from it) so a single node can be previewed as the terminal
   *  output — the tabular preview shows exactly what flows out of that node. */
  const datasetSubgraph = useCallback(
    (rootId: string): CockpitGraph => {
      const full = toGraph(nodes, edges);
      const byId: Record<string, (typeof full.nodes)[number]> = {};
      full.nodes.forEach((n) => { byId[n.id] = n; });
      const incoming: Record<string, string[]> = {};
      full.edges.forEach((e) => { (incoming[e.target] ??= []).push(e.source); });
      const keep = new Set<string>();
      const stack = [rootId];
      while (stack.length) {
        const cur = stack.pop() as string;
        if (keep.has(cur) || !byId[cur]) continue;
        keep.add(cur);
        (incoming[cur] ?? []).forEach((s) => stack.push(s));
      }
      return {
        nodes: full.nodes.filter((n) => keep.has(n.id)),
        edges: full.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
      };
    },
    [nodes, edges]
  );

  /** Run/Preview — ONE always-visible action that paints values onto nodes +
   *  the dock. For a CALC graph it compiles + evaluates via the expr engine
   *  (optionally under a scenario overlay → Δ). For an ALLOCATION stage graph it
   *  compiles to an authored-pool definition and dry-runs Stages 1-7 in
   *  isolation. For a DATASET graph it compiles to ONE parameterized DuckDB query
   *  and runs it → a tabular preview (columns + sample rows + row count) for the
   *  selected node's subgraph (or the terminal). No new engine any way — the
   *  canvas reuses the existing evaluators. */
  const runPreview = useCallback(
    async (overrides?: Record<string, unknown>) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setRunning(true);
      setRunError(null);
      const graph = toGraph(nodes, edges);
      const fam = graphFamilyOf(nodes);
      try {
        if (fam === 'alloc') {
          const stage = await api.previewStageGraph(graph);
          setStagePreview(stage);
          setPreview(null);
          setScenarioPreview(null);
          setDatasetPreview(null);
        } else if (fam === 'dataset') {
          // Preview the SELECTED dataset node's subgraph (Run shows what flows
          // out of the node you're inspecting); fall back to the whole graph.
          const sel = selectedId && nodes.some((n) => n.id === selectedId)
            ? selectedId : null;
          const sub = sel ? datasetSubgraph(sel) : graph;
          const result = await api.previewDataset(sub);
          setDatasetPreview(result);
          setPreview(null);
          setScenarioPreview(null);
          setStagePreview(null);
        } else {
          const base = await api.previewGraph(graph);
          setPreview(base);
          setStagePreview(null);
          setDatasetPreview(null);
          if (overrides && Object.keys(overrides).length) {
            const scen = await api.previewGraph(graph, overrides);
            setScenarioPreview(scen);
          } else {
            setScenarioPreview(null);
          }
        }
      } catch (e) {
        setRunError(String(e));
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
    },
    [nodes, edges, selectedId, datasetSubgraph]
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
    seedStageChain,
    validation,
    preview,
    scenarioPreview,
    stagePreview,
    datasetPreview,
    family,
    running,
    runError,
    runPreview,
    datasetSubgraph,
    toGraph: () => toGraph(nodes, edges),
  };
}

export type GraphModel = ReturnType<typeof useGraphModel>;
