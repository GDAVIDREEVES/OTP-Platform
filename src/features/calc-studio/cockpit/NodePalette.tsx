import { useEffect, useMemo, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Chip, IconButton,
  InputAdornment, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import EditIcon from '@mui/icons-material/Edit';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { api } from '@/shared/api/client';
import { useToast } from '@/shared/providers/DataProvider';
import { VALUE_DIM_LABELS } from '@/shared/glossary/terms';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import type {
  DatasetSource, DatasetSourceField, DatasetSourcesCatalog, Parameter,
} from '@/shared/api/types';
import type { ProvenanceKind } from '@/kernel/audit/ProvenanceChip';
import { valueText } from '../lib';
import ParamEditDialog from '../components/ParamEditDialog';
import { DRAG_MIME, type DragPayload } from './Canvas';
import { presentationFor } from './nodeMeta';
import type { GraphModel } from './useGraphModel';

/** Labels for the dataset / data-prep ops in the Datasets palette group. */
const DATASET_OP_LABELS: Record<string, string> = {
  filter: 'Filter (predicates)',
  aggregate: 'Aggregate (group + measures)',
  join: 'Join (keys)',
  union: 'Union (stack)',
  derive: 'Derive (formula)',
  select: 'Select (columns)',
};

/** Left pane (MC2) — a searchable, DRAGGABLE palette grouped Parameters (with
 *  live governed values + a governed edit pencil) / Measures / Calculations /
 *  Operations. Dragging an item onto the canvas is ONE gesture (no dialog): the
 *  drag payload carries the backend node ``kind`` + seed ``config`` and the
 *  Canvas drops it at the cursor. The param group's pencil opens the SHARED
 *  ParamEditDialog (GP5) — required rationale + bounds, audited at param:{key} —
 *  the same one direct-edit path the Drivers tab uses; no canned-rationale
 *  inline PATCH, no trip to the Drivers tab for the common case.
 */

/** A draggable palette row. Sets the drag payload + a tiny visual affordance. */
function PaletteItem({
  kind, config, label, sub, onAdd,
}: {
  kind: string;
  config: Record<string, unknown>;
  label: string;
  sub?: React.ReactNode;
  onAdd: () => void;
}) {
  const pres = presentationFor(kind);
  const onDragStart = (e: React.DragEvent) => {
    const payload: DragPayload = { kind, config };
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="center"
      draggable
      onDragStart={onDragStart}
      onDoubleClick={onAdd}
      sx={{
        px: 0.75, py: 0.5, borderRadius: 1, cursor: 'grab', userSelect: 'none',
        '&:hover': { bgcolor: '#F1F5F9' },
        '&:active': { cursor: 'grabbing' },
      }}
      title="Drag onto the canvas (or double-click to add at center)"
    >
      <DragIndicatorIcon sx={{ fontSize: 16, color: '#94A3B8' }} />
      <Box
        sx={{
          width: 18, height: 18, borderRadius: '4px', bgcolor: pres.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, color: '#334155', flexShrink: 0,
        }}
      >
        {pres.glyph}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 12.5 }} noWrap>
          {label}
        </Typography>
        {sub}
      </Box>
    </Stack>
  );
}

/** Map a source provenance to the ProvenanceChip kind. */
function provKind(provenance: string): ProvenanceKind {
  return provenance === 'fabricated' ? 'fabricated'
    : provenance === 'authored' ? 'assumed' : 'real';
}

/** A draggable ACDOCA FIELD chip (DS5). Carries a ``datasetField`` payload so the
 *  Canvas seeds a source (+ a role-fit op) on empty canvas, or augments the
 *  dataset node it lands on. A dimension/measure tag rides on the chip. */
function FieldChip({
  table, field,
}: { table: string; field: DatasetSourceField }) {
  const isMeasure = field.role === 'measure';
  const onDragStart = (e: React.DragEvent) => {
    const payload: DragPayload = {
      intent: 'datasetField',
      field: { table, name: field.name, role: field.role },
    };
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <Chip
      size="small"
      draggable
      onDragStart={onDragStart}
      icon={<DragIndicatorIcon sx={{ fontSize: 13 }} />}
      label={
        <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
          {field.name}
          <span style={{ opacity: 0.55, marginLeft: 4 }}>{isMeasure ? 'Σ' : '·'}</span>
        </span>
      }
      variant="outlined"
      title={`Drag ${field.name} (${field.role}, ${field.type}) onto the canvas`}
      sx={{
        height: 22, m: 0.25, cursor: 'grab', userSelect: 'none',
        borderColor: isMeasure ? '#A7F3D0' : '#DDD6FE',
        bgcolor: isMeasure ? '#ECFDF5' : '#F5F3FF',
        '&:active': { cursor: 'grabbing' },
      }}
    />
  );
}

/** A draggable dimension VALUE chip (DS5). Carries a ``datasetValue`` payload so
 *  the Canvas seeds a source + filter (or appends a predicate to a filter it
 *  lands on). The value is bound by the compiler — never interpolated. */
function ValueChip({
  table, column, value,
}: { table: string; column: string; value: string | number }) {
  const onDragStart = (e: React.DragEvent) => {
    const payload: DragPayload = {
      intent: 'datasetValue',
      value: { table, column, value },
    };
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <Chip
      size="small"
      draggable
      onDragStart={onDragStart}
      icon={<DragIndicatorIcon sx={{ fontSize: 12 }} />}
      label={<span style={{ fontFamily: 'monospace', fontSize: 11 }}>{String(value)}</span>}
      variant="outlined"
      title={`Drag ${column} = ${value} onto the canvas → a bound-param filter`}
      sx={{
        height: 20, m: 0.25, cursor: 'grab', userSelect: 'none',
        borderColor: '#CBD5E1',
        '&:active': { cursor: 'grabbing' },
      }}
    />
  );
}

/** The expandable FIELD + VALUE browser for one dataset source (DS5). Fields are
 *  grouped by ``group`` (each a draggable chip); below, the value-enumerable
 *  dimensions list their actual distinct VALUES (each a draggable chip). */
function SourceBrowser({
  source, needle,
}: { source: DatasetSource; needle: string }) {
  const match = (s: string) => !needle || s.toLowerCase().includes(needle);

  // Fields filtered by the search needle (field name or group); when the needle
  // matches the source label itself, keep every field.
  const labelHit = match(source.label) || match(source.table);
  const fields = (source.fields ?? []).filter(
    (f) => labelHit || match(f.name) || match(f.group)
  );
  // Preserve the backend group order (first-seen) but only render non-empty.
  const groupOrder: string[] = [];
  const byGroup: Record<string, DatasetSourceField[]> = {};
  fields.forEach((f) => {
    if (!byGroup[f.group]) { byGroup[f.group] = []; groupOrder.push(f.group); }
    byGroup[f.group].push(f);
  });

  // Value-enumerable dimensions whose name, label, or any value matches.
  const valueCols = Object.entries(source.values ?? {}).filter(([col, vals]) => {
    if (labelHit) return true;
    const lbl = VALUE_DIM_LABELS[col] ?? col;
    return match(col) || match(lbl) || vals.some((v) => match(String(v)));
  });

  return (
    <Box sx={{ pl: 1, pr: 0.5, pb: 0.5 }}>
      {groupOrder.map((g) => (
        <Box key={g} sx={{ mt: 0.5 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
            {g}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', mt: 0.25 }}>
            {byGroup[g].map((f) => (
              <FieldChip key={`${source.table}-${f.name}`} table={source.table} field={f} />
            ))}
          </Box>
        </Box>
      ))}

      {valueCols.length > 0 && (
        <Box sx={{ mt: 0.75 }}>
          <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block' }}>
            Values
          </Typography>
          {valueCols.map(([col, vals]) => {
            // When the needle matches specific values, surface just those.
            const shown = needle && !labelHit && !match(col) && !match(VALUE_DIM_LABELS[col] ?? col)
              ? vals.filter((v) => match(String(v)))
              : vals;
            return (
              <ValueDimension
                key={`${source.table}-vals-${col}`}
                table={source.table}
                column={col}
                label={VALUE_DIM_LABELS[col] ?? col}
                values={shown}
                count={vals.length}
                defaultExpanded={Boolean(needle) && shown.length < vals.length}
              />
            );
          })}
        </Box>
      )}
    </Box>
  );
}

/** One value-enumerable dimension — an accordion of its draggable VALUE chips. */
function ValueDimension({
  table, column, label, values, count, defaultExpanded,
}: {
  table: string; column: string; label: string;
  values: (string | number)[]; count: number; defaultExpanded: boolean;
}) {
  const [open, setOpen] = useState(defaultExpanded);
  useEffect(() => { if (defaultExpanded) setOpen(true); }, [defaultExpanded]);
  return (
    <Box>
      <Stack
        direction="row" spacing={0.5} alignItems="center"
        onClick={() => setOpen((o) => !o)}
        sx={{ cursor: 'pointer', px: 0.5, py: 0.25, borderRadius: 1, '&:hover': { bgcolor: '#F1F5F9' } }}
      >
        <ExpandMoreIcon
          sx={{ fontSize: 16, color: '#94A3B8', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }}
        />
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          {label} <span style={{ color: '#94A3B8', fontFamily: 'monospace' }}>({column})</span>
        </Typography>
        <Chip size="small" label={count} sx={{ height: 15, fontSize: 9.5 }} />
      </Stack>
      {open && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', pl: 2.5, pb: 0.25 }}>
          {values.map((v) => (
            <ValueChip key={`${column}-${v}`} table={table} column={column} value={v} />
          ))}
          {values.length === 0 && (
            <Typography variant="caption" sx={{ color: 'text.secondary', pl: 0.5 }}>
              No matching values.
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

/** One dataset source row (DS5) — an accordion. The SUMMARY row is itself the
 *  draggable whole-table source (dragging it drops a ``source`` node, as before);
 *  the expand caret reveals the grouped, draggable FIELD + VALUE browser. */
function SourceRow({
  source, needle, onAddSource,
}: { source: DatasetSource; needle: string; onAddSource: () => void }) {
  const [open, setOpen] = useState(false);
  // While searching, auto-open a source whose match is a field/value (not just
  // the source label) so the user sees the hit without a manual expand.
  const labelHit = !needle
    || source.label.toLowerCase().includes(needle)
    || source.table.toLowerCase().includes(needle);
  useEffect(() => {
    if (needle && !labelHit) setOpen(true);
  }, [needle, labelHit]);

  const onDragStart = (e: React.DragEvent) => {
    const payload: DragPayload = { kind: 'source', config: { table: source.table } };
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <Box>
      <Stack
        direction="row" spacing={0.5} alignItems="center"
        draggable
        onDragStart={onDragStart}
        onDoubleClick={onAddSource}
        sx={{
          px: 0.5, py: 0.5, borderRadius: 1, cursor: 'grab', userSelect: 'none',
          '&:hover': { bgcolor: '#F1F5F9' }, '&:active': { cursor: 'grabbing' },
        }}
        title="Drag the source onto the canvas, or expand to drag its fields & values"
      >
        <IconButton
          size="small" sx={{ p: 0.25 }}
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        >
          <ExpandMoreIcon
            sx={{ fontSize: 16, color: '#94A3B8', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }}
          />
        </IconButton>
        <DragIndicatorIcon sx={{ fontSize: 15, color: '#94A3B8' }} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 12.5 }} noWrap>
            {source.label}
          </Typography>
          <Box sx={{ mt: 0.25 }}>
            <ProvenanceChip
              source={source.provenance}
              kind={provKind(source.provenance)}
              tooltip={
                source.provenance === 'real' ? 'Real warehouse data (ACDOCA / segment_pl / supply-chain / entity roles)'
                : source.provenance === 'fabricated' ? 'Fabricated seed — fine cost-center grain beneath reconciled totals'
                : 'An ACTIVE authored dataset, referenced as a source'
              }
            />
          </Box>
        </Box>
      </Stack>
      {open && <SourceBrowser source={source} needle={needle} />}
    </Box>
  );
}

function Group({
  title, count, children, defaultExpanded = false,
}: {
  title: string; count: number; children: React.ReactNode; defaultExpanded?: boolean;
}) {
  return (
    <Accordion disableGutters defaultExpanded={defaultExpanded} elevation={0}
      sx={{ '&:before': { display: 'none' }, bgcolor: 'transparent' }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, px: 1, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
        <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 700 }}>
          {title} <Chip size="small" label={count} sx={{ height: 16, fontSize: 10, ml: 0.5 }} />
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0.5, pt: 0 }}>{children}</AccordionDetails>
    </Accordion>
  );
}

export default function NodePalette({ model }: { model: GraphModel }) {
  const toast = useToast();
  const { nodeTypes: cat, addNode, reloadNodeTypes, seedStageChain, family } = model;
  const [q, setQ] = useState('');
  // GP5 — the pencil opens the ONE shared, hardened ParamEditDialog (required
  // rationale + bounds) rather than the old canned-rationale inline PATCH.
  const [editing, setEditing] = useState<Parameter | null>(null);
  // The dataset / data-prep palette catalogue (sources + provenance + ops) — the
  // ACDOCA journal + the fabricated cost lines + the active authored datasets.
  const [dsCat, setDsCat] = useState<DatasetSourcesCatalog | null>(null);
  useEffect(() => {
    api.datasetSources().then(setDsCat).catch(() => setDsCat(null));
  }, []);

  // Drop a node at the canvas center when added by double-click (no position).
  const addCentered = (kind: string, config: Record<string, unknown>) =>
    addNode(kind, config, { x: 240 + Math.random() * 60, y: 120 + Math.random() * 60 });

  const needle = q.trim().toLowerCase();
  const match = (s: string) => !needle || s.toLowerCase().includes(needle);

  const params = useMemo(
    () => (cat?.parameters ?? []).filter((p) => match(p.key) || match(p.category ?? '')),
    [cat, needle]
  );
  const measures = useMemo(
    () =>
      (cat?.measures ?? []).flatMap((t) =>
        t.measures
          .map((col) => ({ table: t.table, col, ref: `${t.table}.${col}` }))
          .filter((m) => match(m.ref))
      ),
    [cat, needle]
  );
  const calcs = useMemo(() => (cat?.calcs ?? []).filter((c) => match(c.id) || match(c.name ?? '')), [cat, needle]);
  const operators = useMemo(() => (cat?.operators ?? []).filter((o) => match(`operator ${o}`) || match(o)), [cat, needle]);
  const comparators = useMemo(() => (cat?.comparators ?? []).filter((o) => match(`compare ${o}`) || match(o)), [cat, needle]);
  const functions = useMemo(() => (cat?.functions ?? []).filter((f) => match(f) || match('function')), [cat, needle]);
  const showStructural = match('if') || match('const') || match('constant') || match('output') || match('operation');
  const stageTypes = useMemo(
    () => (cat?.stage_types ?? []).filter((s) => match(s.type) || match('allocation stage') || match('pool')),
    [cat, needle]
  );
  // The three families never mix on one canvas — only offer the calc-into-stage
  // value subgraphs once a stage graph exists; offer stage seeding only on an
  // empty/alloc canvas; offer dataset nodes only on an empty/dataset canvas.
  const allocCanvas = family === 'alloc';
  const calcCanvas = family === 'calc';
  const datasetCanvas = family === 'dataset';

  // Dataset sources + ops, filtered by the search needle. DS5: a source surfaces
  // when its label/table OR any of its FIELD names/groups OR any of its dimension
  // VALUE codes match — so "0810000", "RACCT", "cost center" and "HSL" all find
  // the right source (and the expanded browser auto-opens to the hit).
  const dsSources = useMemo(
    () =>
      [...(dsCat?.tables ?? []), ...(dsCat?.datasets ?? [])].filter((s) => {
        if (match(s.label) || match(s.table)) return true;
        if ((s.fields ?? []).some((f) => match(f.name) || match(f.group))) return true;
        return Object.entries(s.values ?? {}).some(
          ([col, vals]) =>
            match(col) || match(VALUE_DIM_LABELS[col] ?? '') ||
            vals.some((v) => match(String(v)))
        );
      }),
    [dsCat, needle]
  );
  const dsOps = useMemo(
    () => (dsCat?.node_types ?? []).filter(
      (t) => t.type !== 'source' && (match(t.type) || match('data prep'))),
    [dsCat, needle]
  );

  // Open the shared ParamEditDialog for a governed key — fetch the full row so
  // the dialog has the type / bounds / provenance it needs (the palette catalog
  // carries only key/value/category/unit).
  const openEdit = async (key: string) => {
    try {
      setEditing(await api.parameter(key));
    } catch (e) {
      toast.show(`Could not open ${key}: ${String(e)}`, 'error');
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ p: 1 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search terms…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} /></InputAdornment>
            ),
          }}
        />
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
          Drag a term onto the canvas — one gesture, no dialog.
        </Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 0.5 }}>
        <Group title="Parameters" count={params.length} defaultExpanded>
          {params.map((p) => (
            <Box key={p.key}>
              <PaletteItem
                kind="param"
                config={{ key: p.key }}
                label={p.key}
                onAdd={() => addCentered('param', { key: p.key })}
                sub={
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }} noWrap>
                      = {valueText(p.value)}{p.unit ? ` ${p.unit}` : ''}
                    </Typography>
                    <Tooltip title="Edit governed value (rationale + bounds, audited at param:key)">
                      <IconButton
                        size="small"
                        sx={{ p: 0.25 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          void openEdit(p.key);
                        }}
                      >
                        <EditIcon sx={{ fontSize: 13 }} />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                }
              />
            </Box>
          ))}
          {params.length === 0 && <EmptyHint />}
        </Group>

        <Group title="Measures" count={measures.length}>
          {measures.map((m) => (
            <PaletteItem
              key={m.ref}
              kind="measure"
              config={{ ref: m.ref, grain: 'group' }}
              label={m.ref}
              onAdd={() => addCentered('measure', { ref: m.ref, grain: 'group' })}
            />
          ))}
          {measures.length === 0 && <EmptyHint />}
        </Group>

        <Group title="Calculations" count={calcs.length}>
          {calcs.map((c) => (
            <PaletteItem
              key={c.id}
              kind="calc"
              config={{ calc_id: c.id, output_key: '' }}
              label={c.id}
              onAdd={() => addCentered('calc', { calc_id: c.id, output_key: '' })}
              sub={
                <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                  {c.name}
                </Typography>
              }
            />
          ))}
          {calcs.length === 0 && <EmptyHint />}
        </Group>

        <Group title="Operations" count={operators.length + comparators.length + functions.length + (showStructural ? 4 : 0)}>
          {operators.map((o) => (
            <PaletteItem
              key={`op-${o}`}
              kind="op"
              config={{ op: o }}
              label={`a ${o} b`}
              onAdd={() => addCentered('op', { op: o })}
            />
          ))}
          {functions.map((f) => (
            <PaletteItem
              key={`fn-${f}`}
              kind="func"
              config={{ func: f }}
              label={`${f}(…)`}
              onAdd={() => addCentered('func', { func: f })}
            />
          ))}
          {comparators.map((o) => (
            <PaletteItem
              key={`cmp-${o}`}
              kind="compare"
              config={{ op: o }}
              label={`a ${o} b`}
              onAdd={() => addCentered('compare', { op: o })}
            />
          ))}
          {showStructural && (
            <>
              <PaletteItem kind="if" config={{}} label="if(cond, then, else)" onAdd={() => addCentered('if', {})} />
              <PaletteItem kind="const" config={{ value: '' }} label="constant" onAdd={() => addCentered('const', { value: '' })} />
              <PaletteItem kind="output" config={{}} label="output (result)" onAdd={() => addCentered('output', {})} />
            </>
          )}
        </Group>

        {/* Allocation stages (MC3) — the typed cost-to-charge pipeline. */}
        <Group title="Allocation stages" count={stageTypes.length} defaultExpanded={allocCanvas}>
          {!calcCanvas && (
            <Box sx={{ px: 1, py: 0.5 }}>
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label="+ Add stage pipeline"
                onClick={() => seedStageChain()}
                sx={{ cursor: 'pointer', fontWeight: 700 }}
              />
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                Seeds source → … → recon in canonical order. Configure each stage inline.
              </Typography>
            </Box>
          )}
          {calcCanvas && (
            <Typography variant="caption" sx={{ color: 'text.secondary', px: 1, py: 0.5, display: 'block' }}>
              This canvas holds a calc graph — clear it (New) to build an allocation pool.
            </Typography>
          )}
          {!calcCanvas && stageTypes.map((s) => (
            <PaletteItem
              key={`stage-${s.type}`}
              kind={s.type}
              config={{}}
              label={STAGE_LABELS[s.type] ?? s.type}
              onAdd={() => addCentered(s.type, {})}
              sub={
                <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                  {s.value_inputs.length ? `calc-bindable: ${s.value_inputs.join(', ')}` : 'pipeline stage'}
                </Typography>
              }
            />
          ))}
        </Group>

        {/* Datasets / ACDOCA (DS3) — the data-prep family (relation handles). */}
        <Group
          title="Datasets / ACDOCA"
          count={dsSources.length + dsOps.length}
          defaultExpanded={datasetCanvas}
        >
          {allocCanvas && (
            <Typography variant="caption" sx={{ color: 'text.secondary', px: 1, py: 0.5, display: 'block' }}>
              This canvas holds an allocation pool — clear it (New) to build a dataset.
            </Typography>
          )}
          {!allocCanvas && (
            <>
              <Typography variant="overline" sx={{ color: 'text.secondary', px: 1, display: 'block', mt: 0.5 }}>
                Sources · fields · values
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', px: 1, display: 'block', mb: 0.5 }}>
                Expand a source to drag its ACDOCA fields and account / cost-center / profit-center values.
              </Typography>
              {dsSources.map((s) => (
                <SourceRow
                  key={`ds-src-${s.table}`}
                  source={s}
                  needle={needle}
                  onAddSource={() => addCentered('source', { table: s.table })}
                />
              ))}

              <Typography variant="overline" sx={{ color: 'text.secondary', px: 1, display: 'block', mt: 1 }}>
                Data-prep ops
              </Typography>
              {dsOps.map((t) => (
                <PaletteItem
                  key={`ds-op-${t.type}`}
                  kind={t.type}
                  config={{}}
                  label={DATASET_OP_LABELS[t.type] ?? t.type}
                  onAdd={() => addCentered(t.type, {})}
                  sub={
                    <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                      {t.inputs === 2 ? 'two relations in' : t.inputs === 1 ? 'one relation in' : 'relation'}
                    </Typography>
                  }
                />
              ))}
            </>
          )}
        </Group>

        {/* Dataset → calc bridge (DS3) — a dataset that aggregates to a single
            value, consumed by a calc graph. Offered on a calc/empty canvas. */}
        {!allocCanvas && !datasetCanvas && (
          <Group title="Dataset bridges" count={1}>
            <PaletteItem
              kind="dataset_value"
              config={{}}
              label="dataset → value"
              onAdd={() => addCentered('dataset_value', {})}
              sub={
                <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                  an active dataset's scalar into a calc
                </Typography>
              }
            />
          </Group>
        )}
      </Box>

      {/* GP5 — the one governed-parameter edit dialog (shared with the Drivers
          tab); refreshes the palette's live values on save. */}
      <ParamEditDialog
        open={editing !== null}
        param={editing}
        onClose={() => setEditing(null)}
        onSaved={() => reloadNodeTypes()}
      />
    </Box>
  );
}

/** Human labels for the allocation stage palette rows. */
const STAGE_LABELS: Record<string, string> = {
  source: 'Source (capture rule)',
  pool: 'Pool (metadata)',
  benefit_test: 'Benefit test (exclusions)',
  allocate: 'Allocate (key)',
  markup: 'Markup (policy)',
  charge: 'Charge',
  recon: 'Recon (zero residual)',
};

function EmptyHint() {
  return (
    <Typography variant="caption" sx={{ color: 'text.secondary', px: 1, py: 0.5, display: 'block' }}>
      No matching terms.
    </Typography>
  );
}
