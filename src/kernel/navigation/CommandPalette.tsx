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

/** Extra search terms per process (POL-16) — the words a user reaches for that
 *  aren't in the id/name/pattern. Folded into the palette AND the process-library
 *  search corpus so "true-up", "invoice" or "benchmark" find the right module.
 *  Kept lower-ranked than a literal id/name hit so exact matches always win. */
export const SYNONYMS: Record<string, string> = {
  'OTP-4': 'pricing set policy method',
  'OTP-5': 'csa cost sharing arrangement rab pct buy-in platform contribution',
  'OTP-9': 'invoice billing charge intercompany',
  'OTP-10': 'invoice billing service charge allocation cost-to-charge stewardship',
  'OTP-11': 'csa true-up cost sharing',
  'OTP-13': 'invoice billing interest treasury loan',
  'OTP-16': 'true-up year-end adjustment operating margin',
  'OTP-17': 'true-up year-end adjustment credit note',
  'OTP-25': 'benchmark comparables range arm’s-length study refresh',
  'OTP-29': 'dempe intangibles substance functions',
  'OTP-34': 'cbcr country-by-country beps action 13 table 1',
  'OTP-36': 'beat base erosion anti-abuse minimum tax',
  'OTP-39': 'apa advance pricing agreement',
  'OTP-42': 'invoice billing erp reconciliation posting',
  'OTP-43': 'erp reconciliation value break posting divergence',
  'OTP-44': 'profit split residual',
  'OTP-46': 'wht withholding tax treaty',
};

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
      const id = p.id.toLowerCase();
      const name = p.name.toLowerCase();
      let rank: number | null = null;
      if (!q) rank = 5;
      else if (id === q) rank = 0;
      else if (id.includes(q) || name.includes(q)) rank = 1;
      else if (`${p.category} ${p.pattern}`.toLowerCase().includes(q)) rank = 2;
      else if ((SYNONYMS[p.id] ?? '').toLowerCase().includes(q)) rank = 3;
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
