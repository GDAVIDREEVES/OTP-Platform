import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CalcGraph, CalcGraphNode } from '@/shared/api/types';

/** Lineage graph (CS-d) — a plain-SVG, 4-column DAG over GET /api/calcs/graph:
 *  sources | drivers (parameters) | calculations | processes. Column 0 is
 *  ordered by kind+name (the source id encodes both); later columns by the
 *  mean row of their predecessors (one barycenter pass), so edges stay short.
 *  Node colours reuse the ProvenanceChip palette semantics (real = neutral
 *  slate, assumed = amber tint, fabricated = dashed violet). Hover highlights
 *  the incident edges; click drills through — source → Data Catalog,
 *  parameter → /evidence/param:{key}, calculation → its detail drawer,
 *  process → /process/{id}. */

const COL_X = [80, 320, 560, 800];
const NODE_W = 180;
const NODE_H = 28;
const ROW_GAP = 40;
const VIEW_W = 1000; // last column right edge (800 + 180) + 20 margin

const COL_LABELS = ['Sources', 'Drivers (parameters)', 'Calculations', 'Processes'];

// ProvenanceChip palette semantics for the source/parameter columns; the
// calculation/process columns (no provenance) take the theme ink/action look.
function nodeStyle(n: CalcGraphNode): { stroke: string; fill: string; text: string; dash?: string } {
  if (n.kind === 'calculation') return { stroke: '#1E293B', fill: '#F8FAFC', text: '#0F172A' };
  if (n.kind === 'process') return { stroke: '#2563EB', fill: '#EFF6FF', text: '#1D4ED8' };
  if (n.provenance === 'fabricated') return { stroke: '#7C3AED', fill: '#FFFFFF', text: '#6D28D9', dash: '5 3' };
  if (n.provenance === 'real') return { stroke: '#CBD5E1', fill: '#FFFFFF', text: '#475569' };
  return { stroke: '#F59E0B', fill: '#FFFBEB', text: '#B45309' }; // assumed
}

function truncate(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/** Column buckets + node centre positions + total height. */
function layout(graph: CalcGraph) {
  const cols: CalcGraphNode[][] = [[], [], [], []];
  graph.nodes.forEach((n) => {
    cols[Math.min(Math.max(n.column, 0), 3)].push(n);
  });

  // Column 0: kind+name order (source ids encode "kind:name").
  cols[0].sort((a, b) => a.id.localeCompare(b.id));

  const row = new Map<string, number>();
  cols[0].forEach((n, i) => row.set(n.id, i));

  // Predecessors per node (edge.from → edge.to).
  const preds = new Map<string, string[]>();
  graph.edges.forEach((e) => {
    const list = preds.get(e.to) ?? [];
    list.push(e.from);
    preds.set(e.to, list);
  });

  // One barycenter pass: order each later column by mean predecessor row
  // (nodes without placed predecessors — the parameters — fall back to name).
  for (let c = 1; c < 4; c += 1) {
    const score = (n: CalcGraphNode): number => {
      const rows = (preds.get(n.id) ?? [])
        .map((p) => row.get(p))
        .filter((r): r is number => r !== undefined);
      return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : Number.POSITIVE_INFINITY;
    };
    cols[c].sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sa !== sb) return sa < sb ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    cols[c].forEach((n, i) => row.set(n.id, i));
  }

  const maxRows = Math.max(1, ...cols.map((c) => c.length));
  const height = ROW_GAP * maxRows + 80;
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((colNodes, c) => {
    colNodes.forEach((n, i) => {
      pos.set(n.id, { x: COL_X[c], y: 50 + i * ROW_GAP });
    });
  });
  return { pos, height };
}

export default function LineageGraph({ graph }: { graph: CalcGraph }) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<string | null>(null);
  const { pos, height } = useMemo(() => layout(graph), [graph]);

  const onNodeClick = (n: CalcGraphNode) => {
    if (n.kind === 'parameter') {
      const key = n.id.replace(/^parameter:/, '');
      navigate(`/evidence/${encodeURIComponent(`param:${key}`)}`);
    } else if (n.kind === 'calculation') {
      navigate(`/calc-studio/calculations?calc=${encodeURIComponent(n.id)}`);
    } else if (n.kind === 'process') {
      navigate(`/process/${n.id}`);
    } else {
      navigate('/calc-studio/catalog');
    }
  };

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${height}`}
      style={{ width: '100%', minWidth: 900, display: 'block' }}
      role="img"
      aria-label="Calculation lineage graph"
    >
      {COL_LABELS.map((label, c) => (
        <text
          key={label}
          x={COL_X[c] + NODE_W / 2}
          y={22}
          textAnchor="middle"
          fontSize={11}
          fontWeight={700}
          fill="#64748B"
          style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}
        >
          {label}
        </text>
      ))}
      {graph.edges.map((e) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        const x1 = a.x + NODE_W;
        const x2 = b.x;
        const mid = (x1 + x2) / 2;
        const hot = hovered !== null && (e.from === hovered || e.to === hovered);
        return (
          <path
            key={`${e.from}->${e.to}`}
            d={`M ${x1} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${x2} ${b.y}`}
            fill="none"
            stroke={hot ? '#2563EB' : '#94A3B8'}
            strokeWidth={hot ? 1.8 : 1.2}
            strokeOpacity={hot ? 0.9 : 0.3}
          />
        );
      })}
      {graph.nodes.map((n) => {
        const p = pos.get(n.id);
        if (!p) return null;
        const st = nodeStyle(n);
        const hot = hovered === n.id;
        return (
          <g
            key={n.id}
            transform={`translate(${p.x}, ${p.y - NODE_H / 2})`}
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHovered(n.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onNodeClick(n)}
          >
            <rect
              width={NODE_W}
              height={NODE_H}
              rx={6}
              fill={st.fill}
              stroke={st.stroke}
              strokeDasharray={st.dash}
              strokeWidth={hot ? 2 : 1.2}
            />
            <text
              x={NODE_W / 2}
              y={NODE_H / 2 + 4}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill={st.text}
            >
              {truncate(n.label, 28)}
            </text>
            <title>{`${n.kind}: ${n.label}`}</title>
          </g>
        );
      })}
    </svg>
  );
}
