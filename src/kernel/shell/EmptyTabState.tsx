import { Box, Typography } from '@mui/material';
import InventoryIcon from '@mui/icons-material/Inventory2Outlined';

/** Empty states teach: they say what the tab will hold once the process is
 *  wired, rather than showing a blank panel. */
export default function EmptyTabState({ label, hint }: { label: string; hint?: string }) {
  return (
    <Box sx={{ py: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', color: 'text.secondary' }}>
      <InventoryIcon sx={{ fontSize: 40, color: '#CBD5E1', mb: 1.5 }} />
      <Typography variant="subtitle2" sx={{ color: 'text.primary', fontWeight: 700 }}>
        Nothing on the {label} tab yet
      </Typography>
      <Typography variant="body2" sx={{ maxWidth: 420, mt: 0.5 }}>
        {hint ?? 'This tab will populate once the process is wired with live data.'}
      </Typography>
    </Box>
  );
}
