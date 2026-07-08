import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Chip,
  Dialog,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useProcesses } from '../registry/useProcesses';
import { searchRank } from './searchTerms';

/** Non-process jump targets so ⌘K reaches the whole app, not just OTP-1…50. */
interface Destination {
  to: string;
  primary: string;
  secondary: string;
  terms: string;
}
const DESTINATIONS: Destination[] = [
  { to: '/calc-studio', primary: 'Calc Studio', secondary: 'Calculations · scenarios · allocations · datasets', terms: 'calc studio cockpit calculation allocation dataset scenario' },
  { to: '/master-data', primary: 'Master Data', secondary: 'Entities · accounts · cost centers', terms: 'master data entities accounts cost center reference' },
  { to: '/reports', primary: 'Reports', secondary: 'Close reports & exports', terms: 'reports export' },
  { to: '/review', primary: 'Review queue', secondary: 'Items awaiting approval', terms: 'review queue approve maker checker' },
  { to: '/settings', primary: 'Settings', secondary: 'Workspace settings', terms: 'settings preferences config' },
];

/** Cmd/Ctrl-K palette: jump to any process — or module — in two keystrokes,
 *  keeping a deep tool feeling shallow. Mounted once, globally. Exact OTP-id and
 *  name hits rank above synonym hits; non-process destinations trail. */
export default function CommandPalette() {
  const navigate = useNavigate();
  const { catalog } = useProcesses();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const procs = catalog?.processes ?? [];
    const q = query.trim().toLowerCase();

    type Item =
      | { rank: number; kind: 'process'; id: string; primary: string; secondary: string }
      | { rank: number; kind: 'dest'; to: string; primary: string; secondary: string };
    const items: Item[] = [];

    procs.forEach((p) => {
      // Empty query → neutral rank 5 (catalog order); otherwise the shared
      // id-first ranker (0/1/2/3, or null to drop the item).
      const rank = !q ? 5 : searchRank(p, q);
      if (rank !== null) {
        items.push({ rank, kind: 'process', id: p.id, primary: p.name, secondary: `${p.category} · ${p.pattern}` });
      }
    });

    DESTINATIONS.forEach((d) => {
      const hit = !q || `${d.primary} ${d.secondary} ${d.terms}`.toLowerCase().includes(q);
      if (hit) items.push({ rank: q ? 4 : 6, kind: 'dest', to: d.to, primary: d.primary, secondary: d.secondary });
    });

    items.sort((a, b) => a.rank - b.rank);
    return items.slice(0, q ? 14 : 10);
  }, [catalog, query]);

  const goTo = (item: (typeof results)[number]) => {
    setOpen(false);
    setQuery('');
    navigate(item.kind === 'process' ? `/process/${item.id}/overview` : item.to);
  };

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      fullWidth
      maxWidth="sm"
      PaperProps={{ sx: { position: 'absolute', top: 72 } }}
    >
      <Box sx={{ p: 1.5 }}>
        <TextField
          autoFocus
          fullWidth
          placeholder="Jump to a process or module… (e.g. royalty, OTP-9, true-up, Calc Studio)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) goTo(results[0]);
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />
      </Box>
      <List dense sx={{ maxHeight: 360, overflow: 'auto', pt: 0 }}>
        {results.map((item) => (
          <ListItemButton key={item.kind === 'process' ? item.id : item.to} onClick={() => goTo(item)}>
            <Chip
              label={item.kind === 'process' ? item.id : 'Go'}
              size="small"
              sx={{
                mr: 1.5,
                fontWeight: 700,
                bgcolor: item.kind === 'process' ? '#0F172A' : '#2563EB',
                color: 'white',
              }}
            />
            <ListItemText
              primary={item.primary}
              secondary={item.secondary}
              primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }}
            />
          </ListItemButton>
        ))}
        {!results.length && (
          <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
            <Typography variant="body2">No matching process or module</Typography>
          </Box>
        )}
      </List>
    </Dialog>
  );
}
