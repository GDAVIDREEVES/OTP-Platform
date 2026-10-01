import { useCallback, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/FileDownload';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useEntities } from '@/shared/providers/DataProvider';
import {
  buildCountryBands,
  buildEntityBands,
  buildInitialMatrix,
  countryNames,
  countryOrder,
  parseFunctions,
  type ColumnDef,
  type Matrix,
  type Scope,
} from './lib/accounts';
import HierarchyControls from './components/HierarchyControls';
import { downloadCsv } from '@/shared/utils/download';
import { accounts } from './lib/accounts';
import PnLGrid from './components/PnLGrid';

export default function DetailedPnL() {
  const entities = useEntities();
  const [scope, setScope] = useState<Scope>('country');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [functionFilter, setFunctionFilter] = useState<string>('all');
  const [edits, setEdits] = useState<Record<Scope, Matrix>>({
    country: {},
    entity: {},
    function: {},
  });

  const allCountries = useMemo(
    () => Array.from(new Set(entities.map((e) => e.countryCode))),
    [entities],
  );
  const allFunctions = useMemo(() => {
    const set = new Set<string>();
    entities.forEach((e) =>
      parseFunctions(e.function).forEach((f) => set.add(f)),
    );
    return Array.from(set).sort();
  }, [entities]);

  // Build columns + grouping bands per scope
  const { columns, countryBands, entityBands } = useMemo(() => {
    if (scope === 'country') {
      const cols: ColumnDef[] = countryOrder
        .filter((cc) => entities.some((e) => e.countryCode === cc))
        .map((cc) => {
          const es = entities.filter((e) => e.countryCode === cc);
          const revenue = es.reduce((a, e) => a + e.ytdVolume, 0);
          const weightedMargin =
            es.reduce((a, e) => a + e.ytdVolume * (e.actualMargin ?? 8), 0) /
            revenue;
          const fnVolumes = new Map<string, number>();
          es.forEach((e) =>
            parseFunctions(e.function).forEach((fn) =>
              fnVolumes.set(fn, (fnVolumes.get(fn) || 0) + e.ytdVolume),
            ),
          );
          const dominantFn = Array.from(fnVolumes.entries()).sort(
            (a, b) => b[1] - a[1],
          )[0]?.[0];
          return {
            id: cc,
            label: countryNames[cc] || cc,
            sublabel: `${es.length} ${es.length === 1 ? 'entity' : 'entities'}`,
            countryCode: cc,
            country: countryNames[cc],
            functionName: dominantFn,
            entityCount: es.length,
            revenue,
            opMargin: Math.round(weightedMargin * 10) / 10,
            entities: es,
          };
        });
      return { columns: cols, countryBands: [], entityBands: [] };
    }

    let list = entities;
    if (countryFilter !== 'all')
      list = list.filter((e) => e.countryCode === countryFilter);
    if (functionFilter !== 'all') {
      list = list.filter((e) =>
        parseFunctions(e.function).includes(functionFilter),
      );
    }
    list = [...list].sort((a, b) => {
      const ci =
        countryOrder.indexOf(a.countryCode) -
        countryOrder.indexOf(b.countryCode);
      if (ci !== 0) return ci;
      return a.id.localeCompare(b.id);
    });

    if (scope === 'entity') {
      const cols: ColumnDef[] = list.map((e) => ({
        id: e.id,
        label: e.id,
        sublabel: e.name,
        country: e.country,
        countryCode: e.countryCode,
        functionName: e.function,
        revenue: e.ytdVolume,
        opMargin: e.actualMargin ?? 8,
        entities: [e],
      }));
      return {
        columns: cols,
        countryBands: buildCountryBands(cols),
        entityBands: [],
      };
    }

    // function scope
    const cols: ColumnDef[] = [];
    list.forEach((e) => {
      let fns = parseFunctions(e.function);
      if (functionFilter !== 'all')
        fns = fns.filter((f) => f === functionFilter);
      const splitCount = fns.length || 1;
      fns.forEach((fn) => {
        cols.push({
          id: `${e.id}::${fn}`,
          label: fn,
          sublabel: e.id,
          country: e.country,
          countryCode: e.countryCode,
          functionName: fn,
          revenue: Math.round(e.ytdVolume / splitCount),
          opMargin: e.actualMargin ?? 8,
          entities: [e],
          entityId: e.id,
          entityName: e.name,
        });
      });
    });
    return {
      columns: cols,
      countryBands: buildCountryBands(cols),
      entityBands: buildEntityBands(cols),
    };
  }, [scope, countryFilter, functionFilter, entities]);

  const initialMatrix = useMemo(() => buildInitialMatrix(columns), [columns]);
  const matrix: Matrix = useMemo(() => {
    const merged: Matrix = {};
    columns.forEach((c) => {
      merged[c.id] = {
        ...initialMatrix[c.id],
        ...(edits[scope][c.id] || {}),
      };
    });
    return merged;
  }, [columns, initialMatrix, edits, scope]);

  const updateCell = useCallback(
    (colId: string, accountId: string, value: number) => {
      setEdits((prev) => ({
        ...prev,
        [scope]: {
          ...prev[scope],
          [colId]: {
            ...(prev[scope][colId] || {}),
            [accountId]: value,
          },
        },
      }));
    },
    [scope],
  );

  const resetEdits = () => setEdits((prev) => ({ ...prev, [scope]: {} }));

  const calc = useMemo(() => {
    const result: Record<string, any> = {};
    columns.forEach((c) => {
      const row = matrix[c.id] || {};
      const rev = (row['rev_external'] || 0) + (row['rev_ic'] || 0);
      const cogs = [
        'cogs_materials',
        'cogs_labor',
        'cogs_mfg_oh',
        'cogs_freight',
        'cogs_royalty',
      ].reduce((a, k) => a + (row[k] || 0), 0);
      const gp = rev - cogs;
      const opex = [
        'opex_personnel',
        'opex_facilities',
        'opex_it',
        'opex_marketing',
        'opex_ga',
        'opex_mgmt_fee',
      ].reduce((a, k) => a + (row[k] || 0), 0);
      const op = gp - opex;
      const tax = row['tax_expense'] || 0;
      result[c.id] = {
        totalRev: rev,
        totalCogs: cogs,
        grossProfit: gp,
        grossMargin: rev > 0 ? (gp / rev) * 100 : 0,
        totalOpex: opex,
        operatingProfit: op,
        operatingMargin: rev > 0 ? (op / rev) * 100 : 0,
        tax,
        netIncome: op - tax,
      };
    });
    return result;
  }, [columns, matrix]);

  const dirtyCount = Object.values(edits[scope]).reduce(
    (a, row) => a + Object.keys(row).length,
    0,
  );
  const multiFunctionEntities = useMemo(
    () => entities.filter((e) => parseFunctions(e.function).length > 1).length,
    [entities],
  );


  /** Export exactly what the grid shows — every account row (with edits) plus
   *  the computed subtotal / margin rows — one column per P&L column. */
  const exportCsv = () => {
    const header = ['Line', ...columns.map((c) => (c.sublabel ? `${c.label} (${c.sublabel})` : c.label))];
    const rows: (string | number)[][] = [header];
    const section = (label: string) => rows.push([label, ...columns.map(() => '')]);
    const acctRows = (sec: (typeof accounts)[number]['section']) =>
      accounts
        .filter((a) => a.section === sec)
        .forEach((a) => rows.push([a.label, ...columns.map((c) => Math.round(matrix[c.id]?.[a.id] ?? 0))]));
    const total = (label: string, pick: (id: string) => number, pct = false) =>
      rows.push([label, ...columns.map((c) => (pct ? Number(pick(c.id).toFixed(2)) : Math.round(pick(c.id))))]);
    section('Revenue'); acctRows('revenue'); total('Total revenue', (id) => calc[id].totalRev);
    section('Cost of goods sold'); acctRows('cogs'); total('Total COGS', (id) => calc[id].totalCogs);
    total('Gross profit', (id) => calc[id].grossProfit); total('Gross margin %', (id) => calc[id].grossMargin, true);
    section('Operating expenses'); acctRows('opex'); total('Total opex', (id) => calc[id].totalOpex);
    total('Operating profit', (id) => calc[id].operatingProfit); total('Operating margin %', (id) => calc[id].operatingMargin, true);
    section('Tax'); acctRows('tax'); total('Net income', (id) => calc[id].netIncome);
    downloadCsv(`segmented-pnl-${scope}.csv`, rows);
  };

  return (
    <Paper sx={{ p: 2.5 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ md: 'flex-start' }}
        spacing={1.5}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Detailed P&L — general ledger view
          </Typography>
          <Typography variant="caption" sx={{ color: '#64748B' }}>
            Edit any blue-highlighted cell. Subtotals, operating profit and OM%
            recalculate live.
          </Typography>
        </Box>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          {dirtyCount > 0 && (
            <Chip
              size="small"
              label={`${dirtyCount} edited`}
              sx={{
                bgcolor: '#EFF6FF',
                color: '#1D4ED8',
                fontWeight: 700,
              }}
              onDelete={resetEdits}
              deleteIcon={<RestartAltIcon />}
            />
          )}
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={exportCsv}>
            Export
          </Button>
        </Stack>
      </Stack>

      <HierarchyControls
        scope={scope}
        setScope={setScope}
        countryFilter={countryFilter}
        setCountryFilter={setCountryFilter}
        functionFilter={functionFilter}
        setFunctionFilter={setFunctionFilter}
        allCountries={allCountries}
        allFunctions={allFunctions}
        columns={columns}
        entityCount={entities.length}
        multiFunctionEntities={multiFunctionEntities}
      />

      <PnLGrid
        scope={scope}
        columns={columns}
        matrix={matrix}
        calc={calc}
        countryBands={countryBands}
        entityBands={entityBands}
        updateCell={updateCell}
      />

      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{ mt: 1.5 }}
      >
        <Box
          sx={{
            width: 10,
            height: 10,
            bgcolor: '#FAFCFF',
            border: '1px solid #BFDBFE',
            borderRadius: 0.5,
          }}
        />
        <Typography variant="caption" sx={{ color: '#64748B' }}>
          Editable input
        </Typography>
        <Box
          sx={{
            width: 10,
            height: 10,
            bgcolor: '#F1F5F9',
            borderRadius: 0.5,
            ml: 2,
          }}
        />
        <Typography variant="caption" sx={{ color: '#64748B' }}>
          Calculated subtotal
        </Typography>
      </Stack>
    </Paper>
  );
}
