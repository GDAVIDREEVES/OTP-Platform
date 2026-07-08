import { useParams, useNavigate } from 'react-router-dom';
import { Box, Stack, Tabs, Tab, Typography } from '@mui/material';
import AppShell from '@/shared/components/layout/AppShell';
import PovChip from '@/shared/components/PovChip';
import CockpitPage from './cockpit/CockpitPage';
import CalculationsTab from './tabs/CalculationsTab';
import DriversTab from './tabs/DriversTab';
import ScenariosTab from './tabs/ScenariosTab';
import RunsTab from './tabs/RunsTab';
import AllocationsTab from './tabs/AllocationsTab';
import WaterfallTab from './tabs/WaterfallTab';
import LineageTab from './tabs/LineageTab';
import DataCatalogTab from './tabs/DataCatalogTab';
import DatasetsTab from './tabs/DatasetsTab';
import ProvenanceTab from './tabs/ProvenanceTab';

/** Calc Studio — the first-class calculation-management module (Phase 3+).
 *  The COCKPIT (Phase 7 MC2) is the default landing surface: an Alteryx-style
 *  3-pane command center (palette / React Flow canvas / inline inspector + a
 *  Results dock) that replaces the open-a-modal-Builder + tab-hopping loop. The
 *  remaining tabs — the calculation registry, governed drivers, what-if
 *  scenarios, the run console, the allocation workbench (M7), the waterfall,
 *  the lineage DAG, the data catalog and the provenance rollup — remain
 *  reachable as drill-downs. */

const TABS = [
  { key: 'cockpit', label: 'Cockpit' },
  { key: 'calculations', label: 'Calculations' },
  { key: 'drivers', label: 'Drivers & Assumptions' },
  { key: 'scenarios', label: 'Scenarios' },
  { key: 'runs', label: 'Runs' },
  { key: 'allocations', label: 'Allocations' },
  { key: 'waterfall', label: 'Waterfall' },
  { key: 'lineage', label: 'Lineage' },
  { key: 'catalog', label: 'Data Catalog' },
  { key: 'datasets', label: 'Datasets' },
  { key: 'provenance', label: 'Provenance' },
] as const;

export default function CalcStudioWorkspace() {
  const { tab } = useParams();
  const navigate = useNavigate();
  // The cockpit is the default Calc Studio view.
  const active = TABS.find((t) => t.key === tab)?.key ?? 'cockpit';
  const activeLabel = TABS.find((t) => t.key === active)?.label ?? '';
  const isCockpit = active === 'cockpit';

  return (
    <AppShell
      pageTitle="Calc Studio"
      disableContentPadding={isCockpit}
      breadcrumbs={[{ label: 'Calc Studio', to: '/calc-studio' }, { label: activeLabel }]}
    >
      {!isCockpit && (
        <Box sx={{ mb: 2 }}>
          <Stack direction="row" alignItems="flex-start" spacing={1}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="overline" sx={{ color: 'text.secondary' }}>Governed calculation management</Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>Calc Studio</Typography>
            </Box>
            {/* The active FY context every tab is scoped to (GP6). */}
            <PovChip />
          </Stack>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Every calculation the platform runs — definitions, governed drivers, run history and data
            provenance in one place.
          </Typography>
        </Box>
      )}
      {/* 11 tabs — scrollable so the row never overflows on narrow viewports. */}
      <Tabs
        value={active}
        onChange={(_, v) => navigate(`/calc-studio/${v}`)}
        sx={{ mb: isCockpit ? 0 : 2, px: isCockpit ? 1.5 : 0, borderBottom: isCockpit ? '1px solid' : 'none', borderColor: 'divider' }}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
      >
        {TABS.map((t) => (
          <Tab key={t.key} value={t.key} label={t.label} />
        ))}
      </Tabs>
      {active === 'cockpit' && <CockpitPage />}
      {active === 'calculations' && <CalculationsTab />}
      {active === 'drivers' && <DriversTab />}
      {active === 'scenarios' && <ScenariosTab />}
      {active === 'runs' && <RunsTab />}
      {active === 'allocations' && <AllocationsTab />}
      {active === 'waterfall' && <WaterfallTab />}
      {active === 'lineage' && <LineageTab />}
      {active === 'catalog' && <DataCatalogTab />}
      {active === 'datasets' && <DatasetsTab />}
      {active === 'provenance' && <ProvenanceTab />}
    </AppShell>
  );
}
