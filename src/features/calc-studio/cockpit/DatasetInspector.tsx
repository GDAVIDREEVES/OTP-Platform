import { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Chip, IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { api } from '@/shared/api/client';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import type { DatasetSource, DatasetSourcesCatalog } from '@/shared/api/types';
import type { GraphModel, RFNode } from './useGraphModel';

/** Inline dataset / data-prep inspector (Phase 8 DS3) — the right-pane config
 *  for a DATASET node. No modal dialogs: column multiselects (from the source
 *  allowlist), filter predicate rows, group-by + measure pickers, join keys +
 *  type, union (no config), and a derive formula are rendered inline and patch
 *  the selected node's config in place. The columns offered come from the
 *  UPSTREAM node's output schema (resolved from the catalogue + the wired
 *  source) so the canvas never offers a column the compiler would reject. */

const FILTER_OPS = ['=', '!=', '<', '>', '<=', '>=', 'IN', 'BETWEEN', 'LIKE'];
const AGG_FUNCS = ['SUM', 'COUNT', 'AVG', 'MIN', 'MAX'];
const ARITH_OPS = ['+', '-', '*', '/'];

interface Predicate {
  column?: string;
  op?: string;
  value?: string;
  values?: string[];
  low?: string;
  high?: string;
}
interface Measure { column?: string; func?: string; alias?: string }
interface JoinKey { left?: string; right?: string }

/** Multiselect of column names from a fixed list. */
function ColumnMultiSelect({
  label, options, value, onChange, helper,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  helper?: string;
}) {
  return (
    <TextField
      select size="small" fullWidth label={label} value={value}
      onChange={(e) =>
        onChange(typeof e.target.value === 'string' ? [e.target.value] : (e.target.value as unknown as string[]))
      }
      SelectProps={{ multiple: true, renderValue: (sel) => `${(sel as string[]).length} selected` }}
      helperText={helper ?? `${options.length} available`}
    >
      {options.map((c) => (
        <MenuItem key={c} value={c} sx={{ fontFamily: 'monospace', fontSize: 12.5 }}>{c}</MenuItem>
      ))}
    </TextField>
  );
}

export default function DatasetInspector({
  model, node,
}: {
  model: GraphModel;
  node: RFNode;
}) {
  const { updateNodeConfig, nodes, edges } = model;
  const kind = node.data.kind;
  const config = node.data.config as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => updateNodeConfig(node.id, patch);

  const [dsCat, setDsCat] = useState<DatasetSourcesCatalog | null>(null);
  useEffect(() => {
    api.datasetSources().then(setDsCat).catch(() => setDsCat(null));
  }, []);

  const allSources: DatasetSource[] = useMemo(
    () => [...(dsCat?.tables ?? []), ...(dsCat?.datasets ?? [])],
    [dsCat]
  );

  // The columns available AT THIS NODE come from its UPSTREAM schema: for a
  // source node, the source table's allowlist; for any other node, the columns
  // its single upstream input emits (best-effort — the same source-table
  // allowlist walked through the chain). Join/union expose left+right.
  const upstreamCols = useMemo(
    () => upstreamColumns(node.id, nodes, edges, allSources),
    [node.id, nodes, edges, allSources]
  );

  // ---- source ----
  if (kind === 'source') {
    const table = String(config.table ?? '');
    const src = allSources.find((s) => s.table === table);
    const cols = src ? src.columns.map((c) => c.name) : [];
    const selected = (config.columns as string[]) ?? [];
    return (
      <Stack spacing={1.5}>
        <TextField select size="small" fullWidth label="Source table"
          value={table} onChange={(e) => set({ table: e.target.value, columns: undefined })}>
          {allSources.map((s) => (
            <MenuItem key={s.table} value={s.table}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                <span style={{ flex: 1 }}>{s.label}</span>
              </Stack>
            </MenuItem>
          ))}
        </TextField>
        {src && (
          <Box>
            <ProvenanceChip source={src.provenance}
              kind={src.provenance === 'fabricated' ? 'fabricated' : src.provenance === 'authored' ? 'assumed' : 'real'} />
          </Box>
        )}
        {cols.length > 0 && (
          <ColumnMultiSelect label="Columns (empty = all)" options={cols}
            value={selected} onChange={(v) => set({ columns: v.length ? v : undefined })} />
        )}
      </Stack>
    );
  }

  // ---- filter ----
  if (kind === 'filter') {
    const preds = (config.predicates as Predicate[]) ?? [];
    const patch = (next: Predicate[]) => set({ predicates: next });
    return (
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', flex: 1 }}>Predicates (AND)</Typography>
          <Button size="small" startIcon={<AddIcon />}
            onClick={() => patch([...preds, { column: upstreamCols[0], op: '=' }])}>Add</Button>
        </Stack>
        {preds.map((p, i) => {
          const setP = (q: Partial<Predicate>) => patch(preds.map((x, j) => (j === i ? { ...x, ...q } : x)));
          return (
            <Stack key={i} spacing={0.5} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
              <Stack direction="row" spacing={0.5}>
                <TextField select size="small" label="Column" value={p.column ?? ''} sx={{ flex: 1 }}
                  onChange={(e) => setP({ column: e.target.value })}>
                  {upstreamCols.map((c) => <MenuItem key={c} value={c} sx={{ fontFamily: 'monospace', fontSize: 12 }}>{c}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="Op" value={p.op ?? '='} sx={{ width: 90 }}
                  onChange={(e) => setP({ op: e.target.value })}>
                  {(dsCat?.filter_ops ?? FILTER_OPS).map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                </TextField>
                <IconButton size="small" onClick={() => patch(preds.filter((_, j) => j !== i))}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
              {p.op === 'IN' ? (
                <TextField size="small" label="Values (comma-separated)"
                  value={(p.values ?? []).join(',')}
                  onChange={(e) => setP({ values: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
              ) : p.op === 'BETWEEN' ? (
                <Stack direction="row" spacing={0.5}>
                  <TextField size="small" label="Low" value={p.low ?? ''} onChange={(e) => setP({ low: e.target.value })} />
                  <TextField size="small" label="High" value={p.high ?? ''} onChange={(e) => setP({ high: e.target.value })} />
                </Stack>
              ) : (
                <TextField size="small" label="Value" value={p.value ?? ''} onChange={(e) => setP({ value: e.target.value })} />
              )}
            </Stack>
          );
        })}
        {preds.length === 0 && <Hint text="Add at least one predicate — values are bound parameters." />}
      </Stack>
    );
  }

  // ---- aggregate ----
  if (kind === 'aggregate') {
    const groupBy = (config.group_by as string[]) ?? [];
    const measures = (config.measures as Measure[]) ?? [];
    const patchM = (next: Measure[]) => set({ measures: next });
    return (
      <Stack spacing={1.5}>
        <ColumnMultiSelect label="Group by" options={upstreamCols}
          value={groupBy} onChange={(v) => set({ group_by: v })}
          helper="Empty = aggregate to a single row (a scalar bridge)" />
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', flex: 1 }}>Measures</Typography>
          <Button size="small" startIcon={<AddIcon />}
            onClick={() => patchM([...measures, { column: upstreamCols[0], func: 'SUM' }])}>Add</Button>
        </Stack>
        {measures.map((m, i) => {
          const setM = (q: Partial<Measure>) => patchM(measures.map((x, j) => (j === i ? { ...x, ...q } : x)));
          return (
            <Stack key={i} direction="row" spacing={0.5} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
              <TextField select size="small" label="Func" value={m.func ?? 'SUM'} sx={{ width: 90 }}
                onChange={(e) => setM({ func: e.target.value })}>
                {(dsCat?.agg_funcs ?? AGG_FUNCS).map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
              </TextField>
              <TextField select size="small" label="Column" value={m.column ?? ''} sx={{ flex: 1 }}
                onChange={(e) => setM({ column: e.target.value })}>
                {upstreamCols.map((c) => <MenuItem key={c} value={c} sx={{ fontFamily: 'monospace', fontSize: 12 }}>{c}</MenuItem>)}
              </TextField>
              <TextField size="small" label="Alias" value={m.alias ?? ''} sx={{ width: 90 }}
                onChange={(e) => setM({ alias: e.target.value || undefined })} />
              <IconButton size="small" onClick={() => patchM(measures.filter((_, j) => j !== i))}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
          );
        })}
        {measures.length === 0 && <Hint text="Add at least one measure (SUM over money stays Decimal)." />}
      </Stack>
    );
  }

  // ---- select ----
  if (kind === 'select') {
    const columns = (config.columns as string[]) ?? [];
    return (
      <Stack spacing={1.5}>
        <ColumnMultiSelect label="Keep columns" options={upstreamCols}
          value={columns} onChange={(v) => set({ columns: v })} />
      </Stack>
    );
  }

  // ---- derive ----
  if (kind === 'derive') {
    const left = (config.left as { column?: string; const?: string }) ?? {};
    const right = (config.right as { column?: string; const?: string }) ?? {};
    const operand = (o: { column?: string; const?: string }, onCol: (c: string) => void, onConst: (v: string) => void) => (
      <Stack direction="row" spacing={0.5}>
        <TextField select size="small" label="Column" value={o.column ?? ''} sx={{ flex: 1 }}
          onChange={(e) => onCol(e.target.value)}>
          <MenuItem value="">— constant —</MenuItem>
          {upstreamCols.map((c) => <MenuItem key={c} value={c} sx={{ fontFamily: 'monospace', fontSize: 12 }}>{c}</MenuItem>)}
        </TextField>
        {!o.column && (
          <TextField size="small" label="Const" value={o.const ?? ''} sx={{ width: 90 }}
            onChange={(e) => onConst(e.target.value)} />
        )}
      </Stack>
    );
    return (
      <Stack spacing={1.5}>
        <TextField size="small" fullWidth label="New column name"
          value={String(config.alias ?? '')} onChange={(e) => set({ alias: e.target.value })} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Left operand</Typography>
        {operand(left, (c) => set({ left: c ? { column: c } : {} }), (v) => set({ left: { const: v } }))}
        <TextField select size="small" fullWidth label="Operator" value={String(config.op ?? '+')}
          onChange={(e) => set({ op: e.target.value })}>
          {(dsCat?.arith_ops ?? ARITH_OPS).map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
        </TextField>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Right operand</Typography>
        {operand(right, (c) => set({ right: c ? { column: c } : {} }), (v) => set({ right: { const: v } }))}
      </Stack>
    );
  }

  // ---- join ----
  if (kind === 'join') {
    const { left, right } = twoInputColumns(node.id, nodes, edges, allSources);
    const on = (config.on as JoinKey[]) ?? [];
    const patchOn = (next: JoinKey[]) => set({ on: next });
    return (
      <Stack spacing={1.5}>
        <TextField select size="small" fullWidth label="Join type" value={String(config.how ?? 'INNER')}
          onChange={(e) => set({ how: e.target.value })}>
          <MenuItem value="INNER">Inner</MenuItem>
          <MenuItem value="LEFT">Left</MenuItem>
        </TextField>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', flex: 1 }}>On (key pairs)</Typography>
          <Button size="small" startIcon={<AddIcon />}
            onClick={() => patchOn([...on, { left: left[0], right: right[0] }])}>Add</Button>
        </Stack>
        {on.map((k, i) => {
          const setK = (q: Partial<JoinKey>) => patchOn(on.map((x, j) => (j === i ? { ...x, ...q } : x)));
          return (
            <Stack key={i} direction="row" spacing={0.5} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
              <TextField select size="small" label="Left" value={k.left ?? ''} sx={{ flex: 1 }}
                onChange={(e) => setK({ left: e.target.value })}>
                {left.map((c) => <MenuItem key={c} value={c} sx={{ fontFamily: 'monospace', fontSize: 12 }}>{c}</MenuItem>)}
              </TextField>
              <TextField select size="small" label="Right" value={k.right ?? ''} sx={{ flex: 1 }}
                onChange={(e) => setK({ right: e.target.value })}>
                {right.map((c) => <MenuItem key={c} value={c} sx={{ fontFamily: 'monospace', fontSize: 12 }}>{c}</MenuItem>)}
              </TextField>
              <IconButton size="small" onClick={() => patchOn(on.filter((_, j) => j !== i))}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
          );
        })}
        {on.length === 0 && <Hint text="Wire two relations, then add at least one key pair." />}
      </Stack>
    );
  }

  // ---- union ----
  if (kind === 'union') {
    return (
      <Stack spacing={1}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Wire two schema-compatible relations (<b>left</b> + <b>right</b>). They stack
          (<Chip size="small" label="UNION ALL" sx={{ height: 18, fontSize: 10 }} />); no config to set.
        </Typography>
      </Stack>
    );
  }

  return null;
}

function Hint({ text }: { text: string }) {
  return <Typography variant="caption" sx={{ color: 'text.secondary' }}>{text}</Typography>;
}

// --- column-schema resolution (best-effort, mirrors the compiler chain) -------

/** The output columns of one node, resolved by walking its config over the
 *  upstream schema (source allowlist → filter/select/aggregate/derive transform
 *  → join/union combine). Best-effort for the inline pickers — the backend
 *  compiler is the authority and rejects anything off-allowlist. */
function nodeOutputColumns(
  nodeId: string,
  nodes: RFNode[],
  edges: { source: string; target: string; targetHandle?: string | null }[],
  sources: DatasetSource[]
): string[] {
  const n = nodes.find((x) => x.id === nodeId);
  if (!n) return [];
  const kind = n.data.kind;
  const cfg = n.data.config as Record<string, unknown>;
  if (kind === 'source') {
    const src = sources.find((s) => s.table === String(cfg.table ?? ''));
    const cols = src ? src.columns.map((c) => c.name) : [];
    const requested = (cfg.columns as string[]) ?? [];
    return requested.length ? requested : cols;
  }
  const ins = edges.filter((e) => e.target === nodeId);
  const up = ins.length ? nodeOutputColumns(ins[0].source, nodes, edges, sources) : [];
  if (kind === 'filter') return up;
  if (kind === 'select') return ((cfg.columns as string[]) ?? []).length ? (cfg.columns as string[]) : up;
  if (kind === 'derive') {
    const alias = cfg.alias as string | undefined;
    return alias ? [...up, alias] : up;
  }
  if (kind === 'aggregate') {
    const gb = (cfg.group_by as string[]) ?? [];
    const ms = ((cfg.measures as Measure[]) ?? []).map((m) => m.alias || m.column || 'm').filter(Boolean);
    return [...gb, ...ms];
  }
  if (kind === 'union') return up;
  if (kind === 'join') {
    const { left, right } = twoInputColumns(nodeId, nodes, edges, sources);
    const sel = (cfg.select as { side: string; column: string; alias?: string }[]) ?? [];
    if (sel.length) return sel.map((s) => s.alias || s.column);
    const out = [...left];
    right.forEach((c) => out.push(left.includes(c) ? `${c}_r` : c));
    return out;
  }
  return up;
}

/** The columns flowing INTO a node (its single upstream's output). */
function upstreamColumns(
  nodeId: string,
  nodes: RFNode[],
  edges: { source: string; target: string; targetHandle?: string | null }[],
  sources: DatasetSource[]
): string[] {
  const n = nodes.find((x) => x.id === nodeId);
  if (n?.data.kind === 'source') return nodeOutputColumns(nodeId, nodes, edges, sources);
  const ins = edges.filter((e) => e.target === nodeId);
  if (!ins.length) return [];
  return nodeOutputColumns(ins[0].source, nodes, edges, sources);
}

/** The left/right input columns for a binary (join/union) node. */
function twoInputColumns(
  nodeId: string,
  nodes: RFNode[],
  edges: { source: string; target: string; targetHandle?: string | null }[],
  sources: DatasetSource[]
): { left: string[]; right: string[] } {
  const ins = edges.filter((e) => e.target === nodeId);
  const leftEdge = ins.find((e) => e.targetHandle === 'left') ?? ins[0];
  const rightEdge = ins.find((e) => e.targetHandle === 'right') ?? ins[1];
  return {
    left: leftEdge ? nodeOutputColumns(leftEdge.source, nodes, edges, sources) : [],
    right: rightEdge ? nodeOutputColumns(rightEdge.source, nodes, edges, sources) : [],
  };
}
