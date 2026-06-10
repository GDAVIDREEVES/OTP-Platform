import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Stack } from '@mui/material';
import KpiStrip from '@/kernel/shell/KpiStrip';
import DriversTab from '@/features/calc-studio/tabs/DriversTab';
import DataCatalogTab from '@/features/calc-studio/tabs/DataCatalogTab';
import ProvenanceTab from '@/features/calc-studio/tabs/ProvenanceTab';
import { useParameters, useProvenance } from '@/features/calc-studio/lib';
import type { BindingCtx, KpiItem, ProcessBinding } from '../types';

/** OTP-49 — Data & calculation management console. Now a THIN pointer binding:
 *  the console grew into the first-class Calc Studio module (left nav →
 *  /calc-studio), and these tabs re-use the module's components (lifted to
 *  src/features/calc-studio/) so the process view and the module never drift.
 *  Every parameter edit still PATCHes /api/parameters/{key} and is hash-chained
 *  at record_ref="param:{key}" — the shell Audit tab + /evidence/param:{key}
 *  packet light up automatically. No figures are invented here: every number
 *  is read from the governed store the module manages. */

// ---------------- KPIs ----------------

const Kpis: FC<BindingCtx> = () => {
  const { params } = useParameters();
  const roll = useProvenance();
  const fabricated = (params ?? []).filter((p) => p.provenance === 'fabricated').length;
  const sources = roll?.total ?? 0;
  const warehouse =
    roll
      ? Object.values(roll.buckets).reduce(
          (s, b) => s + b.items.filter((i) => i.kind === 'warehouse').length,
          0,
        )
      : 0;
  const items: KpiItem[] = [
    { key: 'params', label: 'Governed parameters', value: String(params?.length ?? 0), tone: 'ok', provenance: 'parameters' },
    { key: 'fab', label: 'Fabricated magnitudes', value: String(fabricated), tone: fabricated ? 'watch' : 'ok', provenance: 'catalog · provenance' },
    { key: 'src', label: 'Catalogued data sources', value: String(sources), provenance: 'catalog' },
    { key: 'wh', label: 'Warehouse tables', value: String(warehouse), provenance: 'catalog · warehouse' },
  ];
  return <KpiStrip items={items} />;
};

// ---------------- Overview — the pointer to the module ----------------

const Overview: FC<BindingCtx> = () => {
  const navigate = useNavigate();
  return (
    <Stack spacing={2}>
      <Alert
        severity="info"
        action={
          <Button color="inherit" size="small" onClick={() => navigate('/calc-studio')}>
            Open Calc Studio
          </Button>
        }
      >
        This console now lives in the Calc Studio module — calculations, drivers &amp; assumptions,
        scenarios, runs, lineage, the data catalog and provenance in one place.
      </Alert>
      <DriversTab />
    </Stack>
  );
};

export const otp49: ProcessBinding = {
  kpis: Kpis,
  tabs: {
    overview: Overview,
    inputs: DriversTab,
    calculation: DataCatalogTab,
    outputs: ProvenanceTab,
  },
};
