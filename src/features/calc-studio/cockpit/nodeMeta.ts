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

/** A handle's wire colour by kind (null = the terminal output, no out handle). */
export function handleColor(kind: 'value' | 'bool' | 'flow' | null): string {
  if (kind === 'bool') return BOOL_COLOR;
  if (kind === 'flow') return FLOW_COLOR;
  return VALUE_COLOR;
}

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
};

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
    default:
      return '';
  }
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
