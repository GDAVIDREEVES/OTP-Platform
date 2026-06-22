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

/** A handle's wire colour by kind (null = the terminal output, no out handle). */
export function handleColor(kind: 'value' | 'bool' | null): string {
  return kind === 'bool' ? BOOL_COLOR : VALUE_COLOR;
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
    default:
      return '';
  }
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
