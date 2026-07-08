import type { ReactNode } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { GLOSSARY } from '@/shared/glossary/terms';

/** A jargon label with an on-hover explanation (POL-08). Wrap a genuinely
 *  domain-specific label — `<Term k="DEMPE">DEMPE</Term>` or, when the visible
 *  text equals the key, just `<Term k="DEMPE"/>`. Renders a dotted-underline
 *  span (cursor: help) inside an MUI Tooltip showing the glossary expansion and
 *  one-sentence blurb.
 *
 *  Graceful: an unknown key renders the children (or the key) as plain text with
 *  no underline and no tooltip — never a broken affordance.
 */
export default function Term({ k, children }: { k: string; children?: ReactNode }) {
  const entry = GLOSSARY[k];
  const label = children ?? k;

  if (!entry) return <>{label}</>;

  return (
    <Tooltip
      arrow
      title={
        <Box sx={{ py: 0.25 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
            {entry.expansion}
          </Typography>
          {entry.blurb && (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.25, opacity: 0.9 }}>
              {entry.blurb}
            </Typography>
          )}
        </Box>
      }
    >
      <Box
        component="span"
        tabIndex={0}
        sx={{
          cursor: 'help',
          textDecoration: 'underline dotted',
          textUnderlineOffset: '2px',
          textDecorationColor: 'currentColor',
          textDecorationThickness: '1px',
        }}
      >
        {label}
      </Box>
    </Tooltip>
  );
}
