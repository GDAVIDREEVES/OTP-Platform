import type { CockpitNodeTypes } from '@/shared/api/types';

/** Static presentation + handle metadata for the cockpit's calc-value node
 *  types (MC2). The authoritative handle/config schema comes from the backend
 *  (GET /api/calc-graph/node-types — see {@link CockpitNodeTypes}); this only
 *  adds colour, an icon glyph and a human label so the canvas reads at a glance.
 *  Handle KINDS ('value' | 'bool') are resolved from the backend catalogue at
 *  runtime so the canvas can never offer a handle the engine would reject.
 */

export const VALUE_COLOR = '#4338CA'; // indigo — a Decimal scalar/series
export const BOOL_COLOR = '#B45309'; // amber — a comparison (only feeds if.cond)
export const FLOW_COLOR = '#0F766E'; // teal — an allocation stage pipeline edge
export const RELATION_COLOR = '#7C3AED'; // violet — a dataset RELATION edge (DS3)

/** Every handle kind the cockpit canvas draws. ``relation`` is the dataset
 *  family's distinct handle kind (Phase 8 DS3) — kept separate from value/bool/
 *  flow by isValidConnection except at the defined bridges. */
export type HandleKind = 'value' | 'bool' | 'flow' | 'relation' | null;

/** A handle's wire colour by kind (null = the terminal output, no out handle). */
export function handleColor(kind: HandleKind): string {
  if (kind === 'bool') return BOOL_COLOR;
  if (kind === 'flow') return FLOW_COLOR;
  if (kind === 'relation') return RELATION_COLOR;
  return VALUE_COLOR;
}

/** The dataset / data-prep node types (Phase 8 DS3) — a third family with
 *  RELATION handles. ``source`` is a leaf (0 inputs); the rest consume one or
 *  two relation inputs and emit a relation. */
export const DATASET_KINDS = [
  'source', 'filter', 'aggregate', 'join', 'union', 'derive', 'select',
] as const;
export type DatasetKind = (typeof DATASET_KINDS)[number];

/** True for a dataset / data-prep node type. NOTE: ``source`` is shared with the
 *  allocation stage family by NAME, but a stage ``source`` carries a
 *  ``cost_capture_rule`` config and lives only on an alloc canvas; the two never
 *  coexist (the families don't mix on one canvas), so the dataset/calc/alloc
 *  family of a node is resolved from the WHOLE graph, not a node in isolation. */
export function isDatasetKind(kind: string): boolean {
  return (DATASET_KINDS as readonly string[]).includes(kind);
}

/** The dataset relation node arity (inputs) — mirrors the backend catalogue. */
export const DATASET_INPUTS: Record<DatasetKind, number> = {
  source: 0, filter: 1, aggregate: 1, derive: 1, select: 1, join: 2, union: 2,
};

/** The canonical allocation stage order (head → tail). Mirrors the backend
 *  STAGE_ORDER; the canvas uses it to enforce stage-order connections and to
 *  seed a chain. */
export const STAGE_ORDER = [
  'source', 'pool', 'benefit_test', 'allocate', 'markup', 'charge', 'recon',
] as const;

export type StageType = (typeof STAGE_ORDER)[number];

/** True for an allocation stage node type. */
export function isStageKind(kind: string): boolean {
  return (STAGE_ORDER as readonly string[]).includes(kind);
}

export interface NodePresentation {
  label: string;
  glyph: string;
  /** Header tint. */
  accent: string;
  /** True for leaf data sources (param/measure/calc/const) — no input handles. */
  leaf: boolean;
}

export const PRESENTATION: Record<string, NodePresentation> = {
  param: { label: 'Parameter', glyph: 'π', accent: '#EEF2FF', leaf: true },
  measure: { label: 'Measure', glyph: 'Σ', accent: '#ECFDF5', leaf: true },
  calc: { label: 'Calculation', glyph: 'ƒ', accent: '#FEF3C7', leaf: true },
  dataset_value: { label: 'Dataset value', glyph: '⊞', accent: '#F5F3FF', leaf: true },
  const: { label: 'Constant', glyph: '#', accent: '#F1F5F9', leaf: true },
  op: { label: 'Operator', glyph: '×', accent: '#FFF7ED', leaf: false },
  func: { label: 'Function', glyph: 'fn', accent: '#FDF4FF', leaf: false },
  if: { label: 'If / then / else', glyph: '?', accent: '#EFF6FF', leaf: false },
  compare: { label: 'Compare', glyph: '⋚', accent: '#FEF2F2', leaf: false },
  output: { label: 'Output', glyph: '▶', accent: '#E0F2FE', leaf: false },
  // Allocation stages (MC3) — teal-tinted, the cost-to-charge pipeline.
  source: { label: 'Source', glyph: '⛏', accent: '#F0FDFA', leaf: false },
  pool: { label: 'Pool', glyph: '◉', accent: '#F0FDFA', leaf: false },
  benefit_test: { label: 'Benefit test', glyph: '✓', accent: '#F0FDFA', leaf: false },
  allocate: { label: 'Allocate', glyph: '÷', accent: '#F0FDFA', leaf: false },
  markup: { label: 'Markup', glyph: '%', accent: '#F0FDFA', leaf: false },
  charge: { label: 'Charge', glyph: '⇒', accent: '#F0FDFA', leaf: false },
  recon: { label: 'Recon', glyph: '⚖', accent: '#F0FDFA', leaf: false },
  // Dataset / data-prep family (DS3) — violet-tinted, relation handles. NOTE:
  // ``source`` is shared with the alloc stage map above; on a dataset canvas the
  // node renders with its dataset presentation via ``presentationForFamily``.
  filter: { label: 'Filter', glyph: '⧩', accent: '#F5F3FF', leaf: false },
  aggregate: { label: 'Aggregate', glyph: 'Σ', accent: '#F5F3FF', leaf: false },
  join: { label: 'Join', glyph: '⋈', accent: '#F5F3FF', leaf: false },
  union: { label: 'Union', glyph: '⊎', accent: '#F5F3FF', leaf: false },
  derive: { label: 'Derive', glyph: 'ƒx', accent: '#F5F3FF', leaf: false },
  select: { label: 'Select', glyph: '⊡', accent: '#F5F3FF', leaf: false },
};

/** The dataset-family presentation for the SOURCE node (which name-collides with
 *  the alloc stage source). Keyed off the resolved family so a dataset source
 *  reads as a violet "Dataset source", not a teal alloc stage. */
const DATASET_SOURCE_PRESENTATION: NodePresentation = {
  label: 'Dataset source', glyph: '⛁', accent: '#F5F3FF', leaf: true,
};

/** Presentation resolved with the node's FAMILY in hand — disambiguates the
 *  shared ``source`` kind (dataset vs alloc). */
export function presentationForFamily(
  kind: string,
  family: 'calc' | 'alloc' | 'dataset' | 'empty'
): NodePresentation {
  if (kind === 'source' && family === 'dataset') return DATASET_SOURCE_PRESENTATION;
  return presentationFor(kind);
}

export function presentationFor(kind: string): NodePresentation {
  return (
    PRESENTATION[kind] ?? { label: kind, glyph: '•', accent: '#F1F5F9', leaf: false }
  );
}

/** A short, human one-liner summarising a node's current config for the chip
 *  shown on the node body. */
export function configSummary(kind: string, config: Record<string, unknown>): string {
  switch (kind) {
    case 'param':
      return config.key ? `param('${config.key}')` : 'pick a parameter';
    case 'measure':
      return config.ref ? `${config.ref} @ ${config.grain ?? 'group'}` : 'pick a measure';
    case 'calc':
      return config.calc_id ? `${config.calc_id} · ${config.output_key ?? '?'}` : 'pick a calc';
    case 'dataset_value':
      return config.dataset_id
        ? `dataset ${config.dataset_id}${config.column ? ` · ${config.column}` : ''}`
        : config.graph
          ? `inline dataset${config.column ? ` · ${config.column}` : ''}`
          : 'pick a dataset → scalar';
    case 'const':
      return config.value != null && config.value !== '' ? String(config.value) : 'set a value';
    case 'op':
      return config.op ? `a ${config.op} b` : 'pick an operator';
    case 'compare':
      return config.op ? `a ${config.op} b` : 'pick a comparator';
    case 'func':
      return config.func ? `${config.func}(…)` : 'pick a function';
    case 'if':
      return 'if(cond, then, else)';
    case 'output':
      return 'result';
    // ---- allocation stages ----
    case 'source': {
      const rule = (config.cost_capture_rule as Record<string, unknown>) ?? {};
      const dims = [
        ...((rule.cost_centers as string[]) ?? []),
        ...((rule.profit_centers as string[]) ?? []),
        ...((rule.cost_elements as string[]) ?? []),
      ];
      return dims.length ? `capture ${dims.length} dim(s)` : 'set a capture rule';
    }
    case 'pool':
      return config.provider_entity_id ? `provider ${config.provider_entity_id}` : 'set provider + metadata';
    case 'benefit_test': {
      const bens = (config.beneficiaries as string[]) ?? [];
      const exs = (config.exclusions as unknown[]) ?? [];
      return bens.length ? `${bens.length} beneficiary(ies), ${exs.length} excl` : 'pick beneficiaries';
    }
    case 'allocate':
      return config.key_factor ? `${config.key_factor} key` : 'pick a key factor';
    case 'markup': {
      const mps = (config.markup_policies as unknown[]) ?? [];
      return mps.length ? `${mps.length} policy(ies)` : 'add a markup policy';
    }
    case 'charge':
      return 'price + charge out';
    case 'recon':
      return 'zero-residual check';
    // ---- dataset / data-prep nodes (DS3) ----
    case 'filter': {
      const preds = (config.predicates as unknown[]) ?? [];
      return preds.length ? `${preds.length} predicate(s)` : 'add a predicate';
    }
    case 'aggregate': {
      const gb = (config.group_by as string[]) ?? [];
      const ms = (config.measures as unknown[]) ?? [];
      return ms.length ? `group ${gb.length} · ${ms.length} measure(s)` : 'pick a measure';
    }
    case 'join':
      return config.how ? `${String(config.how).toLowerCase()} join` : 'inner/left join';
    case 'union':
      return 'stack two relations';
    case 'derive':
      return config.alias ? `${config.alias} = …` : 'add a column';
    case 'select': {
      const cols = (config.columns as string[]) ?? [];
      return cols.length ? `${cols.length} column(s)` : 'pick columns';
    }
    default:
      return '';
  }
}

/** A dataset SOURCE node's config summary (resolved with family in hand, since
 *  ``source`` collides with the alloc stage). */
export function datasetSourceSummary(config: Record<string, unknown>): string {
  const table = config.table as string | undefined;
  if (!table) return 'pick a source table';
  const cols = (config.columns as string[]) ?? [];
  return cols.length ? `${table} · ${cols.length} col(s)` : table;
}

/** A dataset relation node's input handles (relation kind). ``source`` is a leaf
 *  (no inputs); join/union take two (``left``/``right``); the rest take one
 *  (``in``). */
export function datasetInputsFor(kind: string): { handle: string; kind: 'relation' }[] {
  const n = DATASET_INPUTS[kind as DatasetKind] ?? 0;
  if (n === 0) return [];
  if (n === 1) return [{ handle: 'in', kind: 'relation' }];
  return [{ handle: 'left', kind: 'relation' }, { handle: 'right', kind: 'relation' }];
}

/** Resolve a graph's family from its WHOLE node set. A graph is a DATASET graph
 *  if it has any unambiguously-dataset node (filter/aggregate/join/union/derive/
 *  select) or a ``source`` carrying a dataset ``table`` config; an ALLOC graph if
 *  it has any alloc stage node (pool/benefit_test/…); else a CALC graph. The
 *  three families never mix on one canvas (the connection guard rejects cross-
 *  wires), so this resolves unambiguously. */
export function familyOfNodes(
  nodes: { data: { kind: string; config?: Record<string, unknown> } }[]
): 'calc' | 'alloc' | 'dataset' | 'empty' {
  if (nodes.length === 0) return 'empty';
  const kinds = nodes.map((n) => n.data.kind);
  const hasDatasetOp = kinds.some(
    (k) => k !== 'source' && isDatasetKind(k)
  );
  const datasetSource = nodes.some(
    (n) => n.data.kind === 'source'
      && typeof n.data.config?.table === 'string'
  );
  if (hasDatasetOp || datasetSource) return 'dataset';
  // An alloc stage node (besides the shared ``source``) marks an alloc graph.
  if (kinds.some((k) => k !== 'source' && isStageKind(k))) return 'alloc';
  // A lone ``source`` with no table config + no other signal: treat as alloc
  // (the stage source) — the user seeds the alloc pipeline, not a bare source.
  if (kinds.includes('source')) return 'alloc';
  return 'calc';
}

/** A stage node's input handles: the pipeline ``in`` (flow, except source) plus
 *  the numeric calc-bindable inputs (value) the catalogue declares. */
export function stageInputsFor(
  kind: string,
  catalogue: CockpitNodeTypes | null
): { handle: string; kind: 'value' | 'flow' }[] {
  const spec = catalogue?.stage_types?.find((t) => t.type === kind);
  const handles: { handle: string; kind: 'value' | 'flow' }[] = [];
  if (spec?.flow_in) handles.push({ handle: 'in', kind: 'flow' });
  (spec?.value_inputs ?? []).forEach((h) => handles.push({ handle: h, kind: 'value' }));
  return handles;
}

/** Whether a stage node emits a pipeline ``out`` (recon is terminal). */
export function stageHasFlowOut(kind: string, catalogue: CockpitNodeTypes | null): boolean {
  return catalogue?.stage_types?.find((t) => t.type === kind)?.flow_out ?? false;
}

/** Resolve a node type's input handles (with kinds) from the backend catalogue.
 *  func nodes are variadic — the count comes from the node's wired inputs, so
 *  the canvas grows in0,in1,… one slot ahead of what's connected. */
export function inputHandlesFor(
  kind: string,
  catalogue: CockpitNodeTypes | null,
  wiredCount: number
): { handle: string; kind: 'value' | 'bool' | null }[] {
  const spec = catalogue?.node_types.find((t) => t.type === kind);
  if (!spec) return [];
  if (spec.inputs === 'variadic') {
    // Show every wired slot plus one open slot to drop the next wire into.
    const n = Math.max(wiredCount + 1, 1);
    return Array.from({ length: n }, (_, i) => ({ handle: `in${i}`, kind: 'value' as const }));
  }
  return spec.inputs.map((h) => ({ handle: h.handle, kind: h.kind }));
}

/** Output handle kind for a node type (null = terminal output node). */
export function outputKindFor(
  kind: string,
  catalogue: CockpitNodeTypes | null
): 'value' | 'bool' | null {
  const spec = catalogue?.node_types.find((t) => t.type === kind);
  return spec ? spec.output : 'value';
}
