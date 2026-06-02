import { Box, Chip, List, ListItemButton, ListItemText, Typography } from '@mui/material';
import { CATEGORY_ORDER, type Category } from '../registry/types';

export type CategoryFilter = Category | 'all';

interface Props {
  categories: Record<string, string>;
  counts: Record<string, number>;
  selected: CategoryFilter;
  onSelect: (c: CategoryFilter) => void;
  total: number;
}

/** The slim, always-visible lifecycle rail (A–G). Lifecycle order mirrors the
 *  close cadence the user already runs, so they never translate from what
 *  they're doing to where the software filed it. */
export default function CategoryRail({ categories, counts, selected, onSelect, total }: Props) {
  const Item = ({ value, primary, count }: { value: CategoryFilter; primary: string; count: number }) => (
    <ListItemButton
      selected={selected === value}
      onClick={() => onSelect(value)}
      sx={{ borderRadius: 1.5, mb: 0.5 }}
    >
      <ListItemText primary={primary} primaryTypographyProps={{ fontSize: 14, fontWeight: selected === value ? 700 : 500 }} />
      <Chip label={count} size="small" sx={{ ml: 1 }} />
    </ListItemButton>
  );

  return (
    <Box sx={{ width: { xs: '100%', md: 248 }, flexShrink: 0, position: { md: 'sticky' }, top: { md: 84 } }}>
      <Typography variant="overline" sx={{ color: 'text.secondary', px: 1.5 }}>
        Lifecycle
      </Typography>
      <List dense>
        <Item value="all" primary="All processes" count={total} />
        {CATEGORY_ORDER.map((c) => (
          <Item key={c} value={c} primary={`${c} · ${categories[c] ?? c}`} count={counts[c] ?? 0} />
        ))}
      </List>
    </Box>
  );
}
