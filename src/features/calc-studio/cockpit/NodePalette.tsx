import { useMemo, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Chip, IconButton,
  InputAdornment, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import EditIcon from '@mui/icons-material/Edit';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { api } from '@/shared/api/client';
import { useSessionUser } from '@/shared/providers/SessionProvider';
import { useToast } from '@/shared/providers/DataProvider';
import { valueText } from '../lib';
import { DRAG_MIME, type DragPayload } from './Canvas';
import { presentationFor } from './nodeMeta';
import type { GraphModel } from './useGraphModel';

/** Left pane (MC2) — a searchable, DRAGGABLE palette grouped Parameters (with
 *  live governed values + an inline driver edit) / Measures / Calculations /
 *  Operations. Dragging an item onto the canvas is ONE gesture (no dialog): the
 *  drag payload carries the backend node ``kind`` + seed ``config`` and the
 *  Canvas drops it at the cursor. The param group also offers an inline
 *  governed edit that routes through the existing param:{key} audit — no trip
 *  to the Drivers tab for the common case.
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
  const user = useSessionUser();
  const toast = useToast();
  const { nodeTypes: cat, addNode, reloadNodeTypes } = model;
  const [q, setQ] = useState('');
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);

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

  const saveDriver = async (key: string) => {
    setSavingKey(key);
    try {
      // Free-form value: try JSON first (numbers/bools/arrays), else keep the
      // raw string. The store records the edit at param:{key} (audited).
      let value: unknown = editVal;
      try { value = JSON.parse(editVal); } catch { /* keep string */ }
      await api.patchParameter(key, { value, actor: user.id, rationale: 'Inline cockpit driver edit' });
      toast.show(`Driver ${key} updated — recorded at param:${key}`, 'success');
      setEditKey(null);
      reloadNodeTypes();
    } catch (e) {
      toast.show(`Driver edit failed: ${String(e)}`, 'error');
    } finally {
      setSavingKey(null);
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
                    <Tooltip title="Edit governed value inline (audited at param:key)">
                      <IconButton
                        size="small"
                        sx={{ p: 0.25 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditKey(editKey === p.key ? null : p.key);
                          setEditVal(typeof p.value === 'object' ? JSON.stringify(p.value) : String(p.value ?? ''));
                        }}
                      >
                        <EditIcon sx={{ fontSize: 13 }} />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                }
              />
              {editKey === p.key && (
                <Stack direction="row" spacing={0.5} sx={{ px: 1, pb: 0.75 }}>
                  <TextField
                    size="small"
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void saveDriver(p.key); }}
                    sx={{ flex: 1, '& input': { fontFamily: 'monospace', fontSize: 12, py: 0.5 } }}
                    autoFocus
                  />
                  <Chip
                    size="small"
                    color="primary"
                    label={savingKey === p.key ? 'Saving…' : 'Save'}
                    onClick={() => void saveDriver(p.key)}
                    disabled={savingKey === p.key}
                    sx={{ cursor: 'pointer' }}
                  />
                </Stack>
              )}
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
      </Box>
    </Box>
  );
}

function EmptyHint() {
  return (
    <Typography variant="caption" sx={{ color: 'text.secondary', px: 1, py: 0.5, display: 'block' }}>
      No matching terms.
    </Typography>
  );
}
