import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Chip, Collapse, IconButton, Stack, Typography } from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ProvenanceChip from '@/kernel/audit/ProvenanceChip';
import type { ProvenanceKind } from '@/kernel/audit/ProvenanceChip';
import type { ShapedStep } from '@/shared/api/types';
import { provKind, valueText, PROV_META, useCatalog } from '../lib';

/** Trace tree (CS-d) — the "explain this number" walk down a shaped run:
 *  one bordered card per step (number, label, monospace formula), with the
 *  step's figures as compact chips, the governed parameter reads (amber
 *  "overridden" badge when a scenario overlay supplied the value) and the
 *  catalog sources as ProvenanceChips that deep-link to the Data Catalog tab.
 *  All content comes from the API's shaped_trace — nothing is invented here. */

function StepCard({
  step,
  index,
  provBySource,
  onSourceClick,
}: {
  step: ShapedStep;
  index: number;
  provBySource: Record<string, ProvenanceKind>;
  onSourceClick: () => void;
}) {
  const [open, setOpen] = useState(true);
  const hasDetail =
    step.params.length > 0 || Object.keys(step.values).length > 0 || step.sources.length > 0;

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Box
          sx={{
            width: 22, height: 22, borderRadius: '50%', bgcolor: '#EEF2FF', color: '#4338CA',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}
        >
          {index + 1}
        </Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}>
          {step.label}
        </Typography>
        {hasDetail && (
          <IconButton
            size="small"
            onClick={() => setOpen(!open)}
            aria-label={open ? 'Collapse step' : 'Expand step'}
          >
            {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        )}
      </Stack>
      <Box
        sx={{
          fontFamily: 'monospace', fontSize: 12, bgcolor: '#F8FAFC',
          border: '1px solid #E2E8F0', borderRadius: 1, p: 1, mt: 1,
          whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
        }}
      >
        {step.formula}
      </Box>
      <Collapse in={open}>
        <Stack spacing={1} sx={{ mt: 1 }}>
          {step.params.length > 0 && (
            <Stack direction="row" alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              {step.params.map((p) => (
                <Stack key={p.key} direction="row" spacing={0.5} alignItems="center">
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`${p.key} = ${valueText(p.value)}`}
                    sx={{ height: 20, fontSize: 11, fontFamily: 'monospace', maxWidth: 420 }}
                  />
                  {p.overridden && (
                    <Chip
                      size="small"
                      color="warning"
                      label="overridden"
                      sx={{ height: 20, fontSize: 10, fontWeight: 700 }}
                    />
                  )}
                </Stack>
              ))}
            </Stack>
          )}
          {Object.keys(step.values).length > 0 && (
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              {Object.entries(step.values).map(([k, v]) => (
                <Typography
                  key={k}
                  variant="caption"
                  sx={{ fontFamily: 'monospace', bgcolor: '#F1F5F9', borderRadius: 0.5, px: 0.75, py: 0.25 }}
                >
                  {k} = {valueText(v)}
                </Typography>
              ))}
            </Stack>
          )}
          {step.sources.length > 0 && (
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              {step.sources.map((sid) => (
                <ProvenanceChip
                  key={sid}
                  source={sid}
                  kind={provBySource[sid] ?? 'assumed'}
                  tooltip={`${PROV_META[provBySource[sid] ?? 'assumed'].hint} — open the Data Catalog`}
                  onClick={onSourceClick}
                />
              ))}
            </Stack>
          )}
        </Stack>
      </Collapse>
    </Box>
  );
}

export default function TraceTree({ steps }: { steps: ShapedStep[] }) {
  const navigate = useNavigate();
  const entries = useCatalog();
  const provBySource: Record<string, ProvenanceKind> = {};
  (entries ?? []).forEach((e) => {
    provBySource[e.id] = provKind(e.provenance);
  });

  if (steps.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        No trace steps recorded for this run.
      </Typography>
    );
  }

  return (
    <Stack spacing={1}>
      {steps.map((s, i) => (
        <StepCard
          key={s.id}
          step={s}
          index={i}
          provBySource={provBySource}
          onSourceClick={() => navigate('/calc-studio/catalog')}
        />
      ))}
    </Stack>
  );
}
