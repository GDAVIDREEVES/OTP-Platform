import { Breadcrumbs, Link as MuiLink, Typography } from '@mui/material';
import { Link } from 'react-router-dom';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';

export interface Crumb {
  label: string;
  /** Omit on the last (current-page) crumb — it renders as plain text. */
  to?: string;
}

/** The Toolbar breadcrumb trail. Slots in where the bare page-title Typography
 *  used to sit: the final crumb keeps the title's visual weight, earlier crumbs
 *  are muted links. Never wraps — the row truncates before it shoves the
 *  Toolbar controls off-screen. */
export default function AppBreadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <Breadcrumbs
      aria-label="breadcrumb"
      separator={<NavigateNextIcon sx={{ fontSize: 16, color: '#94A3B8' }} />}
      sx={{
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' },
        '& .MuiBreadcrumbs-li': { minWidth: 0 },
      }}
    >
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        if (isLast || !c.to) {
          return (
            <Typography
              key={i}
              variant={isLast ? 'h6' : 'body2'}
              noWrap
              title={c.label}
              sx={{
                fontWeight: isLast ? 700 : 500,
                fontSize: isLast ? { xs: 15, md: 17 } : 14,
                color: isLast ? '#0F172A' : '#64748B',
                maxWidth: isLast ? { xs: 180, md: 460 } : 200,
              }}
            >
              {c.label}
            </Typography>
          );
        }
        return (
          <MuiLink
            key={i}
            component={Link}
            to={c.to}
            underline="hover"
            color="inherit"
            title={c.label}
            sx={{
              fontSize: 14,
              fontWeight: 500,
              color: '#64748B',
              whiteSpace: 'nowrap',
              '&:hover': { color: '#2563EB' },
            }}
          >
            {c.label}
          </MuiLink>
        );
      })}
    </Breadcrumbs>
  );
}
