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

/** Cmd/Ctrl-K palette: jump to any process in two keystrokes, keeping a deep
 *  tool feeling shallow. Mounted once, globally. */
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
    if (!q) return procs.slice(0, 8);
    return procs
      .filter((p) => `${p.id} ${p.name} ${p.category} ${p.pattern}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [catalog, query]);

  const go = (id: string) => {
    setOpen(false);
    setQuery('');
    navigate(`/process/${id}/overview`);
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
          placeholder="Jump to a process… (e.g. royalty, OTP-9, monitoring)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) go(results[0].id);
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
        {results.map((p) => (
          <ListItemButton key={p.id} onClick={() => go(p.id)}>
            <Chip label={p.id} size="small" sx={{ mr: 1.5, fontWeight: 700, bgcolor: '#0F172A', color: 'white' }} />
            <ListItemText
              primary={p.name}
              secondary={`${p.category} · ${p.pattern}`}
              primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }}
            />
          </ListItemButton>
        ))}
        {!results.length && (
          <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
            <Typography variant="body2">No matching process</Typography>
          </Box>
        )}
      </List>
    </Dialog>
  );
}
