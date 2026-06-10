import { useParams, useNavigate } from 'react-router-dom';
import { Box, Tabs, Tab, Typography } from '@mui/material';
import AppShell from '@/shared/components/layout/AppShell';
import EmptyTabState from '@/kernel/shell/EmptyTabState';
import CalculationsTab from './tabs/CalculationsTab';
import DriversTab from './tabs/DriversTab';
import ScenariosTab from './tabs/ScenariosTab';
import RunsTab from './tabs/RunsTab';
import DataCatalogTab from './tabs/DataCatalogTab';
import ProvenanceTab from './tabs/ProvenanceTab';

/** Calc Studio — the first-class calculation-management module (Phase 3).
 *  Mirrors enterprise FP&A/EPM platforms: the calculation registry, the
 *  governed drivers, what-if scenarios, the run console, lineage (CS-d), the
 *  data catalog and the provenance rollup — one module over the governed
 *  subsystem the OTP-49 console (now a thin pointer binding) introduced. */

const TABS = [
  { key: 'calculations', label: 'Calculations' },
  { key: 'drivers', label: 'Drivers & Assumptions' },
  { key: 'scenarios', label: 'Scenarios' },
  { key: 'runs', label: 'Runs' },
  { key: 'lineage', label: 'Lineage' },
  { key: 'catalog', label: 'Data Catalog' },
  { key: 'provenance', label: 'Provenance' },
] as const;

export default function CalcStudioWorkspace() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const active = TABS.find((t) => t.key === tab)?.key ?? 'calculations';

  return (
    <AppShell pageTitle="Calc Studio">
      <Box sx={{ mb: 2 }}>
        <Typography variant="overline" sx={{ color: 'text.secondary' }}>Governed calculation management</Typography>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Calc Studio</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Every calculation the platform runs — definitions, governed drivers, run history and data
          provenance in one place.
        </Typography>
      </Box>
      <Tabs value={active} onChange={(_, v) => navigate(`/calc-studio/${v}`)} sx={{ mb: 2 }}>
        {TABS.map((t) => (
          <Tab key={t.key} value={t.key} label={t.label} />
        ))}
      </Tabs>
      {active === 'calculations' && <CalculationsTab />}
      {active === 'drivers' && <DriversTab />}
      {active === 'scenarios' && <ScenariosTab />}
      {active === 'runs' && <RunsTab />}
      {active === 'lineage' && (
        <EmptyTabState
          label="Lineage"
          hint="The dependency graph — sources → parameters → calculations → processes — arrives with CS-d."
        />
      )}
      {active === 'catalog' && <DataCatalogTab />}
      {active === 'provenance' && <ProvenanceTab />}
    </AppShell>
  );
}
