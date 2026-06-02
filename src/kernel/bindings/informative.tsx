import type { FC } from 'react';
import { Alert, Box, Stack, Typography } from '@mui/material';
import type { BindingCtx, ProcessBinding } from './types';
import { FALLBACK_CATALOG } from '../registry/fallback';

const APPLIC: Record<string, string> = { H: 'High', M: 'Medium', L: 'Low' };

const Field: FC<{ label: string; value: string }> = ({ label, value }) => (
  <Box sx={{ display: 'flex', gap: 2, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
    <Typography
      variant="caption"
      sx={{ width: 150, flexShrink: 0, color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}
    >
      {label}
    </Typography>
    <Typography variant="body2" sx={{ color: 'text.primary' }}>{value}</Typography>
  </Box>
);

const Overview: FC<BindingCtx> = ({ def }) => {
  const catLabel = FALLBACK_CATALOG.categories[def.category] ?? def.category;
  return (
    <Stack spacing={2} sx={{ maxWidth: 760 }}>
      <Alert severity="info" variant="outlined">
        This process is part of the full 50-process library. Its guided workflow and
        live data aren&rsquo;t wired for this demo yet — the marquee close-cycle
        processes are. The shell, audit affordances, and navigation are identical.
      </Alert>
      <Box>
        <Field label="Process" value={`${def.id} · ${def.name}`} />
        <Field label="Category" value={`${def.category} — ${catLabel}`} />
        <Field label="Primary pattern" value={def.pattern} />
        <Field label="OECD anchor" value={def.oecdAnchor} />
        <Field label="Owner function" value={def.ownerFunction} />
        <Field label="Cadence" value={def.cadence} />
        <Field label="Pharma applicability" value={APPLIC[def.pharmaApplicability] ?? def.pharmaApplicability} />
      </Box>
    </Stack>
  );
};

const Docs: FC<BindingCtx> = () => (
  <Alert severity="info" variant="outlined" sx={{ maxWidth: 760 }}>
    Linked documents will appear here — intercompany agreements, DEMPE memos,
    benchmarking sets, OECD anchors, and exported evidence packets.
  </Alert>
);

/** A complete-but-informative binding for processes not yet wired with live
 *  data: a real Overview (purpose, anchor, owner, cadence) and a Docs tab.
 *  Tab components receive the process via context, so no argument is needed. */
export function informativeBinding(): ProcessBinding {
  return { tabs: { overview: Overview, docs: Docs } };
}
