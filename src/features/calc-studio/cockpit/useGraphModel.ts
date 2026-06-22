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
import { familyOfNodes, isDatasetKind } from './nodeMeta';
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

  /** DS5 — drop an ACDOCA FIELD from the palette.
   *
   *  Onto an existing dataset node: add the field to that node's columns /
   *  group-by / measures / predicates as fits its role + kind (no new node).
   *  Onto empty canvas (or a non-dataset target): seed a ``source`` for the
   *  field's table projecting that one column, plus the natural next node — a
   *  MEASURE seeds an ``aggregate`` (SUM it), a DIMENSION seeds a ``select``
   *  (project it; grow into a group-by later). One gesture, no dialog. */
  const dropField = useCallback(
    (
      field: { table: string; name: string; role: 'dimension' | 'measure' },
      targetId: string | null,
      position: { x: number; y: number }
    ) => {
      if (targetId) {
        const target = nodes.find((n) => n.id === targetId);
        if (target && isDatasetKind(target.data.kind)) {
          const kind = target.data.kind;
          const cfg = target.data.config ?? {};
          const patch: Record<string, unknown> = {};
          if (kind === 'source' || kind === 'select') {
            const cur = (cfg.columns as string[]) ?? [];
            if (!cur.includes(field.name)) patch.columns = [...cur, field.name];
          } else if (kind === 'aggregate') {
            if (field.role === 'measure') {
              const cur = (cfg.measures as Record<string, unknown>[]) ?? [];
              if (!cur.some((m) => m.column === field.name)) {
                patch.measures = [...cur, { column: field.name, func: 'SUM' }];
              }
            } else {
              const cur = (cfg.group_by as string[]) ?? [];
              if (!cur.includes(field.name)) patch.group_by = [...cur, field.name];
            }
          } else if (kind === 'filter') {
            const cur = (cfg.predicates as Record<string, unknown>[]) ?? [];
            patch.predicates = [...cur, { column: field.name, op: '=', value: '' }];
          }
          if (Object.keys(patch).length) updateNodeConfig(targetId, patch);
          setSelectedId(targetId);
          return targetId;
        }
      }
      const srcId = nextNodeId();
      const opId = nextNodeId();
      const opKind = field.role === 'measure' ? 'aggregate' : 'select';
      const opConfig: Record<string, unknown> =
        field.role === 'measure'
          ? { group_by: [], measures: [{ column: field.name, func: 'SUM' }] }
          : { columns: [field.name] };
      setNodes((nds) =>
        nds.concat([
          {
            id: srcId, type: 'cockpit', position,
            data: { kind: 'source', config: { table: field.table, columns: [field.name] } },
          },
          {
            id: opId, type: 'cockpit',
            position: { x: position.x + 220, y: position.y },
            data: { kind: opKind, config: opConfig },
          },
        ])
      );
      setEdges((eds) =>
        eds.concat({
          id: `e_field_${srcId}_${opId}`,
          source: srcId, sourceHandle: 'out', target: opId, targetHandle: 'in',
        })
      );
      setSelectedId(opId);
      setPreview(null); setScenarioPreview(null);
      setStagePreview(null); setDatasetPreview(null);
      return opId;
    },
    [nodes, updateNodeConfig]
  );

  /** DS5 — drop a VALUE chip from the palette (carries {table, column, value}).
   *
   *  Onto an existing ``filter`` node: append the predicate (no new node). Onto
   *  empty canvas: seed a ``source`` for the table + a ``filter`` with the
   *  predicate ``{col, op:'=', value}``. The value rides through config and is
   *  BOUND by the compiler — never interpolated (injection-safe by construction). */
  const dropValue = useCallback(
    (
      value: { table: string; column: string; value: string | number },
      targetId: string | null,
      position: { x: number; y: number }
    ) => {
      const predicate = { column: value.column, op: '=', value: value.value };
      if (targetId) {
        const target = nodes.find((n) => n.id === targetId);
        if (target && target.data.kind === 'filter') {
          const cur = (target.data.config?.predicates as Record<string, unknown>[]) ?? [];
          updateNodeConfig(targetId, { predicates: [...cur, predicate] });
          setSelectedId(targetId);
          return targetId;
        }
      }
      const srcId = nextNodeId();
      const fltId = nextNodeId();
      setNodes((nds) =>
        nds.concat([
          {
            id: srcId, type: 'cockpit', position,
            data: { kind: 'source', config: { table: value.table } },
          },
          {
            id: fltId, type: 'cockpit',
            position: { x: position.x + 220, y: position.y },
            data: { kind: 'filter', config: { predicates: [predicate] } },
          },
        ])
      );
      setEdges((eds) =>
        eds.concat({
          id: `e_value_${srcId}_${fltId}`,
          source: srcId, sourceHandle: 'out', target: fltId, targetHandle: 'in',
        })
      );
      setSelectedId(fltId);
      setPreview(null); setScenarioPreview(null);
      setStagePreview(null); setDatasetPreview(null);
      return fltId;
    },
    [nodes, updateNodeConfig]
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
    dropField,
    dropValue,
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
