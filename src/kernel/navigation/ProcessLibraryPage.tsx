import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import SearchIcon from '@mui/icons-material/Search';
import SearchOffIcon from '@mui/icons-material/SearchOff';
import AppShell from '@/shared/components/layout/AppShell';
import EmptyState from '@/shared/components/EmptyState';
import { useProcesses } from '../registry/useProcesses';
import { CATEGORY_ORDER, type Category, type ProcessDef } from '../registry/types';
import CategoryRail, { type CategoryFilter } from './CategoryRail';
import { isMarquee } from '../bindings';
import { SYNONYMS } from './CommandPalette';

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

/** Rank a process against a search needle (POL-16). Exact OTP-id match ranks
 *  first, then an id/name substring, then category/pattern, then a synonym hit.
 *  Returns null when nothing matches so the card drops out. */
function searchRank(def: ProcessDef, needle: string): number | null {
  const id = def.id.toLowerCase();
  const name = def.name.toLowerCase();
  if (id === needle) return 0;
  if (id.includes(needle) || name.includes(needle)) return 1;
  if (`${def.category} ${def.pattern}`.toLowerCase().includes(needle)) return 2;
  if ((SYNONYMS[def.id] ?? '').toLowerCase().includes(needle)) return 3;
  return null;
}

function CardGrid({ items, onOpen }: { items: ProcessDef[]; onOpen: (id: string) => void }) {
  return (
    <Box
      sx={{
        mt: 1.5,
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' },
        gap: 2,
      }}
    >
      {items.map((p) => (
        <ProcessCard key={p.id} def={p} onOpen={() => onOpen(p.id)} />
      ))}
    </Box>
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
  // A `?q=` deep link pre-fills the search (same seed-once-on-mount pattern).
  const [query, setQuery] = useState(searchParams.get('q') ?? '');

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    catalog?.processes.forEach((p) => {
      c[p.category] = (c[p.category] ?? 0) + 1;
    });
    return c;
  }, [catalog]);

  const procs = catalog?.processes ?? [];
  const needle = query.trim().toLowerCase();

  // Search results — ranked (id-first), across the selected category filter.
  const ranked = useMemo(() => {
    if (!needle) return [];
    return procs
      .filter((p) => selected === 'all' || p.category === selected)
      .map((p) => ({ p, rank: searchRank(p, needle) }))
      .filter((x): x is { p: ProcessDef; rank: number } => x.rank !== null)
      .sort((a, b) => a.rank - b.rank || a.p.id.localeCompare(b.p.id, undefined, { numeric: true }))
      .map((x) => x.p);
  }, [procs, needle, selected]);

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
  const visibleCats = selected === 'all' ? CATEGORY_ORDER : [selected];
  const open = (id: string) => navigate(`/process/${id}/overview`);

  const searchField = (
    <TextField
      size="small"
      fullWidth
      placeholder="Search processes — id, name, pattern, or keyword (e.g. true-up, benchmark, OTP-9)"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      sx={{ mb: 3 }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon sx={{ fontSize: 20 }} />
          </InputAdornment>
        ),
      }}
    />
  );

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
          {searchField}

          {needle ? (
            ranked.length ? (
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  Results
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {ranked.length} {ranked.length === 1 ? 'process' : 'processes'} match “{query.trim()}”
                </Typography>
                <CardGrid items={ranked} onOpen={open} />
              </Box>
            ) : (
              <EmptyState
                icon={<SearchOffIcon />}
                title={`No processes match “${query.trim()}”`}
                body="Try an OTP id, a process name, or a keyword like “true-up”, “benchmark” or “invoice”."
                cta={{ label: 'Clear search', onClick: () => setQuery('') }}
              />
            )
          ) : (
            visibleCats.map((cat) => {
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
                  <CardGrid items={items} onOpen={open} />
                </Box>
              );
            })
          )}
        </Box>
      </Stack>
    </AppShell>
  );
}
