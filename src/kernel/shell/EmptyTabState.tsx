import InventoryIcon from '@mui/icons-material/Inventory2Outlined';
import EmptyState from '@/shared/components/EmptyState';

/** Empty states teach: they say what the tab will hold once the process is
 *  wired, rather than showing a blank panel. A thin wrapper over the standard
 *  EmptyState (POL-09) so the process-shell tabs share one look with the rest of
 *  the app. */
export default function EmptyTabState({ label, hint }: { label: string; hint?: string }) {
  return (
    <EmptyState
      icon={<InventoryIcon />}
      title={`Nothing on the ${label} tab yet`}
      body={hint ?? 'This tab will populate once the process is wired with live data.'}
    />
  );
}
