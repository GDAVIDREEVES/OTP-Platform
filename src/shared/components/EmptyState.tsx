import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Stack, Typography } from '@mui/material';

/** A standard empty-state action — a primary or secondary button that either
 *  navigates (`to`) or runs a handler (`onClick`). */
export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  to?: string;
}

/** One coherent empty state (POL-09): a centered icon, a title, an optional
 *  body line, and up to two actions. Used everywhere a surface has nothing to
 *  show yet — zero results, an unrun calculation, a blank canvas — so "empty"
 *  always teaches what belongs here and how to fill it, instead of a bare panel.
 */
export default function EmptyState({
  icon,
  title,
  body,
  cta,
  secondary,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  cta?: EmptyStateAction;
  secondary?: EmptyStateAction;
}) {
  const navigate = useNavigate();

  const handle = (action: EmptyStateAction) => () => {
    action.onClick?.();
    if (action.to) navigate(action.to);
  };

  return (
    <Box
      sx={{
        py: 6,
        px: 3,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        color: 'text.secondary',
      }}
    >
      {icon && (
        <Box sx={{ mb: 1.5, color: '#CBD5E1', display: 'flex', '& svg': { fontSize: 40 } }}>
          {icon}
        </Box>
      )}
      <Typography variant="subtitle2" sx={{ color: 'text.primary', fontWeight: 700 }}>
        {title}
      </Typography>
      {body && (
        <Typography variant="body2" sx={{ maxWidth: 440, mt: 0.5 }}>
          {body}
        </Typography>
      )}
      {(cta || secondary) && (
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          {cta && (
            <Button variant="contained" size="small" onClick={handle(cta)}>
              {cta.label}
            </Button>
          )}
          {secondary && (
            <Button variant="outlined" size="small" onClick={handle(secondary)}>
              {secondary.label}
            </Button>
          )}
        </Stack>
      )}
    </Box>
  );
}
