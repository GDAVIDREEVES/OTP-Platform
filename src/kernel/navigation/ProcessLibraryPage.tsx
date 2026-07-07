import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import AppShell from '@/shared/components/layout/AppShell';
import { useProcesses } from '../registry/useProcesses';
import { CATEGORY_ORDER, type Category, type ProcessDef } from '../registry/types';
import CategoryRail, { type CategoryFilter } from './CategoryRail';
import { isMarquee } from '../bindings';

function ProcessCard({ def, onOpen }: { def: ProcessDef; onOpen: () => void }) {
  return (
    <Paper
      variant="outlined"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
      sx={{
        p: 2,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        minHeight: 116,
        transition: 'border-color 120ms, box-shadow 120ms',
        '&:hover, &:focus-visible': {
          borderColor: '#2563EB',
          boxShadow: '0 1px 8px rgba(37,99,235,0.14)',
          outline: 'none',
        },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        <Chip label={def.id} size="small" sx={{ fontWeight: 700, bgcolor: '#0F172A', color: 'white' }} />
        {def.top15 && (
          <StarIcon sx={{ fontSize: 16, color: '#D97706' }} role="img" aria-label="Top 15 pharmaceutical risk" />
        )}
        {def.pharmaApplicability === 'M' && <Chip label="Med" size="small" variant="outlined" />}
        {isMarquee(def.id) ? (
          <Chip label="Live" size="small" color="success" sx={{ ml: 'auto', height: 20, fontWeight: 700 }} />
        ) : (
          <Chip
            label="Reference"
            size="small"
            variant="outlined"
            sx={{ ml: 'auto', height: 20, color: 'text.secondary', borderColor: 'divider' }}
          />
        )}
      </Stack>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
        {def.name}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', mt: 'auto' }}>
        {def.pattern}
      </Typography>
    </Paper>
  );
}

export default function ProcessLibraryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { catalog, loading, error } = useProcesses();
  // A `?cat=A…G` deep link (e.g. from a process breadcrumb) pre-selects that
  // lifecycle category; anything else falls back to "all". Seeded once on mount
  // — the only entry point is arriving on this route fresh (which remounts), so
  // there is no need to re-sync `selected` if the query later changes in place.
  const catParam = searchParams.get('cat');
  const [selected, setSelected] = useState<CategoryFilter>(
    catParam && (CATEGORY_ORDER as string[]).includes(catParam) ? (catParam as Category) : 'all',
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    catalog?.processes.forEach((p) => {
      c[p.category] = (c[p.category] ?? 0) + 1;
    });
    return c;
  }, [catalog]);

  if (loading) {
    return (
      <AppShell pageTitle="Process library">
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
          <CircularProgress />
        </Box>
      </AppShell>
    );
  }

  const cats = catalog?.categories ?? {};
  const procs = catalog?.processes ?? [];
  const visibleCats = selected === 'all' ? CATEGORY_ORDER : [selected];

  return (
    <AppShell pageTitle="Process library">
      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Showing a limited catalog — the process API was unreachable.
        </Alert>
      )}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems="flex-start">
        <CategoryRail
          categories={cats}
          counts={counts}
          selected={selected}
          onSelect={setSelected}
          total={procs.length}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {visibleCats.map((cat) => {
            const items = procs.filter((p) => p.category === cat);
            if (!items.length) return null;
            return (
              <Box key={cat} sx={{ mb: 4 }}>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  {cat} · {cats[cat] ?? ''}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {items.length} processes
                </Typography>
                <Box
                  sx={{
                    mt: 1.5,
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' },
                    gap: 2,
                  }}
                >
                  {items.map((p) => (
                    <ProcessCard key={p.id} def={p} onOpen={() => navigate(`/process/${p.id}/overview`)} />
                  ))}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Stack>
    </AppShell>
  );
}
