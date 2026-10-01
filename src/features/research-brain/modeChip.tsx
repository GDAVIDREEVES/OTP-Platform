import React from 'react';
import { Chip } from '@mui/material';
import type { ResearchBrainMode } from '@/shared/api/client';

/** One visual vocabulary for "where did this answer come from", shared by the
 *  full page and the side panel: purple = cited knowledge base, blue = Claude
 *  without retrieval, amber = nothing configured. */
export const MODE_STYLE: Record<ResearchBrainMode, { label: string; bg: string; color: string }> = {
  researchbrain: { label: 'knowledge base · cited', bg: '#EDE9FE', color: '#7C3AED' },
  claude: { label: 'claude · direct', bg: '#DBEAFE', color: '#1D4ED8' },
  offline: { label: 'offline fallback', bg: '#FEF3C7', color: '#B45309' },
};

export function modeOf(m: { mode?: ResearchBrainMode; live: boolean }): ResearchBrainMode {
  return m.mode ?? (m.live ? 'researchbrain' : 'offline');
}

export function ModeChip({ mode, title, sx }: { mode: ResearchBrainMode; title?: string; sx?: object }) {
  const s = MODE_STYLE[mode];
  return (
    <Chip
      size="small"
      label={s.label}
      title={title}
      sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: s.bg, color: s.color, ...sx }}
    />
  );
}
