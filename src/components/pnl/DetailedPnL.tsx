import React, { useCallback, useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Stack,
  Typography,
  TextField,
  Chip,
  Button,
  Tooltip,
  Breadcrumbs,
  MenuItem,
  Select,
  FormControl,
  InputLabel } from
'@mui/material';
import DownloadIcon from '@mui/icons-material/FileDownload';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import PublicIcon from '@mui/icons-material/Public';
import BusinessIcon from '@mui/icons-material/Business';
import CategoryIcon from '@mui/icons-material/Category';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { Entity } from '../data/entities';
import { useEntities } from '../../data/DataProvider';
type Scope = 'country' | 'entity' | 'function';
interface Account {
  id: string;
  label: string;
  section: 'revenue' | 'cogs' | 'opex' | 'tax';
  indent?: number;
}
const accounts: Account[] = [
{
  id: 'rev_external',
  label: 'External revenue (third-party)',
  section: 'revenue'
},
{
  id: 'rev_ic',
  label: 'Intercompany revenue',
  section: 'revenue'
},
{
  id: 'cogs_materials',
  label: 'Direct materials',
  section: 'cogs'
},
{
  id: 'cogs_labor',
  label: 'Direct labor',
  section: 'cogs'
},
{
  id: 'cogs_mfg_oh',
  label: 'Manufacturing overhead',
  section: 'cogs'
},
{
  id: 'cogs_freight',
  label: 'Freight & logistics',
  section: 'cogs'
},
{
  id: 'cogs_royalty',
  label: 'Royalties & license fees paid',
  section: 'cogs'
},
{
  id: 'opex_personnel',
  label: 'Personnel & benefits',
  section: 'opex'
},
{
  id: 'opex_facilities',
  label: 'Facilities & utilities',
  section: 'opex'
},
{
  id: 'opex_it',
  label: 'IT & software',
  section: 'opex'
},
{
  id: 'opex_marketing',
  label: 'Marketing & advertising',
  section: 'opex'
},
{
  id: 'opex_ga',
  label: 'General & administrative',
  section: 'opex'
},
{
  id: 'opex_mgmt_fee',
  label: 'Management / concept fees paid',
  section: 'opex'
},
{
  id: 'tax_expense',
  label: 'Income tax expense',
  section: 'tax'
}];

type Matrix = Record<string, Record<string, number>>;
function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = h * 31 + str.charCodeAt(i) | 0;
  return Math.abs(h);
}
function buildInitialMatrix(
cols: {
  id: string;
  revenue: number;
  opMargin: number;
}[])
: Matrix {
  const m: Matrix = {};
  cols.forEach((c) => {
    const row: Record<string, number> = {};
    const icRev = c.revenue;
    const externalRev = Math.round(
      icRev * (1.4 + hash(c.id + 'ext') % 60 / 100)
    );
    const totalRev = externalRev + icRev;
    const opProfit = Math.round(totalRev * (c.opMargin / 100));
    const grossProfitTarget = Math.round(
      totalRev * Math.max(0.18, c.opMargin / 100 + 0.14)
    );
    const totalCogs = totalRev - grossProfitTarget;
    const totalOpex = grossProfitTarget - opProfit;
    const cogsSplit = [0.42, 0.22, 0.16, 0.12, 0.08];
    row['rev_external'] = externalRev;
    row['rev_ic'] = icRev;
    row['cogs_materials'] = Math.round(totalCogs * cogsSplit[0]);
    row['cogs_labor'] = Math.round(totalCogs * cogsSplit[1]);
    row['cogs_mfg_oh'] = Math.round(totalCogs * cogsSplit[2]);
    row['cogs_freight'] = Math.round(totalCogs * cogsSplit[3]);
    row['cogs_royalty'] = Math.round(totalCogs * cogsSplit[4]);
    const opexSplit = [0.38, 0.12, 0.14, 0.14, 0.14, 0.08];
    row['opex_personnel'] = Math.max(0, Math.round(totalOpex * opexSplit[0]));
    row['opex_facilities'] = Math.max(0, Math.round(totalOpex * opexSplit[1]));
    row['opex_it'] = Math.max(0, Math.round(totalOpex * opexSplit[2]));
    row['opex_marketing'] = Math.max(0, Math.round(totalOpex * opexSplit[3]));
    row['opex_ga'] = Math.max(0, Math.round(totalOpex * opexSplit[4]));
    row['opex_mgmt_fee'] = Math.max(0, Math.round(totalOpex * opexSplit[5]));
    row['tax_expense'] = Math.max(0, Math.round(opProfit * 0.24));
    m[c.id] = row;
  });
  return m;
}
interface ColumnDef {
  id: string;
  label: string;
  sublabel: string;
  country?: string;
  countryCode?: string;
  functionName?: string;
  entityCount?: number;
  revenue: number;
  opMargin: number;
  entities: Entity[];
  // For function scope — which entity this function-column belongs to
  entityId?: string;
  entityName?: string;
}
const countryNames: Record<string, string> = {
  US: 'United States',
  GB: 'United Kingdom',
  CH: 'Switzerland',
  IE: 'Ireland',
  CA: 'Canada',
  MX: 'Mexico'
};
const countryOrder = ['US', 'GB', 'CH', 'IE', 'CA', 'MX'];
// Parse entity.function (e.g., "R&D / Contract R&D") into an array of functions
function parseFunctions(fn: string): string[] {
  return fn.split(/\s*\/\s*/).filter(Boolean);
}
function fmt(n: number) {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
export default function DetailedPnL() {
  const entities = useEntities();
  const [scope, setScope] = useState<Scope>('country');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [functionFilter, setFunctionFilter] = useState<string>('all');
  const [edits, setEdits] = useState<Record<Scope, Matrix>>({
    country: {},
    entity: {},
    function: {}
  });
  const allCountries = useMemo(
    () => Array.from(new Set(entities.map((e) => e.countryCode))),
    [entities]
  );
  const allFunctions = useMemo(() => {
    const set = new Set<string>();
    entities.forEach((e) =>
    parseFunctions(e.function).forEach((f) => set.add(f))
    );
    return Array.from(set).sort();
  }, [entities]);
  // Build columns + grouping bands per scope
  const { columns, countryBands, entityBands } = useMemo(() => {
    if (scope === 'country') {
      const cols: ColumnDef[] = countryOrder.
      filter((cc) => entities.some((e) => e.countryCode === cc)).
      map((cc) => {
        const es = entities.filter((e) => e.countryCode === cc);
        const revenue = es.reduce((a, e) => a + e.ytdVolume, 0);
        const weightedMargin =
        es.reduce((a, e) => a + e.ytdVolume * (e.actualMargin ?? 8), 0) /
        revenue;
        const fnVolumes = new Map<string, number>();
        es.forEach((e) =>
        parseFunctions(e.function).forEach((fn) =>
        fnVolumes.set(fn, (fnVolumes.get(fn) || 0) + e.ytdVolume)
        )
        );
        const dominantFn = Array.from(fnVolumes.entries()).sort(
          (a, b) => b[1] - a[1]
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
          entities: es
        };
      });
      return {
        columns: cols,
        countryBands: [],
        entityBands: []
      };
    }
    // entity + function scopes share filtering logic
    let list = entities;
    if (countryFilter !== 'all')
    list = list.filter((e) => e.countryCode === countryFilter);
    if (functionFilter !== 'all') {
      list = list.filter((e) =>
      parseFunctions(e.function).includes(functionFilter)
      );
    }
    // Order by country -> entity id
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
        entities: [e]
      }));
      const bands = buildCountryBands(cols);
      return {
        columns: cols,
        countryBands: bands,
        entityBands: []
      };
    }
    // function scope: each entity contributes one column per function it performs.
    // When filtering by function, only columns matching that function are shown.
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
          // Split entity revenue evenly across functions
          revenue: Math.round(e.ytdVolume / splitCount),
          opMargin: e.actualMargin ?? 8,
          entities: [e],
          entityId: e.id,
          entityName: e.name
        });
      });
    });
    const cBands = buildCountryBands(cols);
    const eBands = buildEntityBands(cols);
    return {
      columns: cols,
      countryBands: cBands,
      entityBands: eBands
    };
  }, [scope, countryFilter, functionFilter, entities]);
  const initialMatrix = useMemo(() => buildInitialMatrix(columns), [columns]);
  const matrix: Matrix = useMemo(() => {
    const merged: Matrix = {};
    columns.forEach((c) => {
      merged[c.id] = {
        ...initialMatrix[c.id],
        ...(edits[scope][c.id] || {})
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
            [accountId]: value
          }
        }
      }));
    },
    [scope]
  );
  const resetEdits = () =>
  setEdits((prev) => ({
    ...prev,
    [scope]: {}
  }));
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
      'cogs_royalty'].
      reduce((a, k) => a + (row[k] || 0), 0);
      const gp = rev - cogs;
      const opex = [
      'opex_personnel',
      'opex_facilities',
      'opex_it',
      'opex_marketing',
      'opex_ga',
      'opex_mgmt_fee'].
      reduce((a, k) => a + (row[k] || 0), 0);
      const op = gp - opex;
      const tax = row['tax_expense'] || 0;
      result[c.id] = {
        totalRev: rev,
        totalCogs: cogs,
        grossProfit: gp,
        grossMargin: rev > 0 ? gp / rev * 100 : 0,
        totalOpex: opex,
        operatingProfit: op,
        operatingMargin: rev > 0 ? op / rev * 100 : 0,
        tax,
        netIncome: op - tax
      };
    });
    return result;
  }, [columns, matrix]);
  const dirtyCount = Object.values(edits[scope]).reduce(
    (a, row) => a + Object.keys(row).length,
    0
  );
  // Count of entities with multiple functions (for messaging)
  const multiFunctionEntities = useMemo(
    () => entities.filter((e) => parseFunctions(e.function).length > 1).length,
    [entities]
  );
  return (
    <Paper
      sx={{
        p: 2.5
      }}>
      
      <Stack
        direction={{
          xs: 'column',
          md: 'row'
        }}
        justifyContent="space-between"
        alignItems={{
          md: 'flex-start'
        }}
        spacing={1.5}
        sx={{
          mb: 2
        }}>
        
        <Box>
          <Typography
            variant="subtitle1"
            sx={{
              fontWeight: 700
            }}>
            
            Detailed P&L — general ledger view
          </Typography>
          <Typography
            variant="caption"
            sx={{
              color: '#64748B'
            }}>
            
            Edit any blue-highlighted cell. Subtotals, operating profit and OM%
            recalculate live.
          </Typography>
        </Box>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap>
          
          {dirtyCount > 0 &&
          <Chip
            size="small"
            label={`${dirtyCount} edited`}
            sx={{
              bgcolor: '#EFF6FF',
              color: '#1D4ED8',
              fontWeight: 700
            }}
            onDelete={resetEdits}
            deleteIcon={<RestartAltIcon />} />

          }
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />}>
            Export
          </Button>
        </Stack>
      </Stack>

      <Box
        sx={{
          border: '1px solid #E2E8F0',
          borderRadius: 2,
          p: 2,
          mb: 2,
          bgcolor: '#F8FAFC'
        }}>
        
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.5}
          sx={{
            mb: 1.5
          }}
          flexWrap="wrap"
          useFlexGap>
          
          <Typography
            variant="caption"
            sx={{
              color: '#475569',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
            
            Hierarchy
          </Typography>
          <Breadcrumbs
            separator={
            <ChevronRightIcon
              sx={{
                fontSize: 14,
                color: '#94A3B8'
              }} />

            }
            sx={{
              fontSize: 13
            }}>
            
            <HierarchyStep
              icon={
              <PublicIcon
                sx={{
                  fontSize: 16
                }} />

              }
              label="Country"
              active={scope === 'country'}
              onClick={() => setScope('country')} />
            
            <HierarchyStep
              icon={
              <BusinessIcon
                sx={{
                  fontSize: 16
                }} />

              }
              label="Entity"
              active={scope === 'entity'}
              onClick={() => setScope('entity')} />
            
            <HierarchyStep
              icon={
              <CategoryIcon
                sx={{
                  fontSize: 16
                }} />

              }
              label="Function"
              active={scope === 'function'}
              onClick={() => setScope('function')} />
            
          </Breadcrumbs>
        </Stack>

        {scope === 'country' &&
        <Typography
          variant="body2"
          sx={{
            color: '#475569'
          }}>
          
            Viewing <b>{columns.length} countries</b>, each rolling up all
            entities in that jurisdiction.
          </Typography>
        }

        {scope === 'entity' &&
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap>
          
            <Typography
            variant="body2"
            sx={{
              color: '#475569'
            }}>
            
              Showing{' '}
              <b>
                {columns.length} of {entities.length} entities
              </b>
              , grouped by country.
            </Typography>
            <Box
            sx={{
              flex: 1
            }} />
          
            <FormControl
            size="small"
            sx={{
              minWidth: 180
            }}>
            
              <InputLabel>Country</InputLabel>
              <Select
              value={countryFilter}
              label="Country"
              onChange={(e) => setCountryFilter(e.target.value)}>
              
                <MenuItem value="all">All countries</MenuItem>
                {allCountries.map((cc) =>
              <MenuItem key={cc} value={cc}>
                    {countryNames[cc] || cc} ({cc})
                  </MenuItem>
              )}
              </Select>
            </FormControl>
            <FormControl
            size="small"
            sx={{
              minWidth: 220
            }}>
            
              <InputLabel>Function</InputLabel>
              <Select
              value={functionFilter}
              label="Function"
              onChange={(e) => setFunctionFilter(e.target.value)}>
              
                <MenuItem value="all">All functions</MenuItem>
                {allFunctions.map((fn) =>
              <MenuItem key={fn} value={fn}>
                    {fn}
                  </MenuItem>
              )}
              </Select>
            </FormControl>
            {(countryFilter !== 'all' || functionFilter !== 'all') &&
          <Button
            size="small"
            onClick={() => {
              setCountryFilter('all');
              setFunctionFilter('all');
            }}>
            
                Clear filters
              </Button>
          }
          </Stack>
        }

        {scope === 'function' &&
        <Stack spacing={1}>
            <Stack
            direction="row"
            spacing={1.5}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap>
            
              <Typography
              variant="body2"
              sx={{
                color: '#475569'
              }}>
              
                Showing <b>{columns.length} function columns</b> across{' '}
                {new Set(columns.map((c) => c.entityId)).size} entities.
                Entities performing multiple functions appear as multiple
                columns.
              </Typography>
              <Box
              sx={{
                flex: 1
              }} />
            
              <FormControl
              size="small"
              sx={{
                minWidth: 180
              }}>
              
                <InputLabel>Country</InputLabel>
                <Select
                value={countryFilter}
                label="Country"
                onChange={(e) => setCountryFilter(e.target.value)}>
                
                  <MenuItem value="all">All countries</MenuItem>
                  {allCountries.map((cc) =>
                <MenuItem key={cc} value={cc}>
                      {countryNames[cc] || cc} ({cc})
                    </MenuItem>
                )}
                </Select>
              </FormControl>
              <FormControl
              size="small"
              sx={{
                minWidth: 220
              }}>
              
                <InputLabel>Function</InputLabel>
                <Select
                value={functionFilter}
                label="Function"
                onChange={(e) => setFunctionFilter(e.target.value)}>
                
                  <MenuItem value="all">All functions</MenuItem>
                  {allFunctions.map((fn) =>
                <MenuItem key={fn} value={fn}>
                      {fn}
                    </MenuItem>
                )}
                </Select>
              </FormControl>
              {(countryFilter !== 'all' || functionFilter !== 'all') &&
            <Button
              size="small"
              onClick={() => {
                setCountryFilter('all');
                setFunctionFilter('all');
              }}>
              
                  Clear filters
                </Button>
            }
            </Stack>
            <Stack
            direction="row"
            spacing={0.75}
            alignItems="center"
            sx={{
              color: '#64748B'
            }}>
            
              <InfoOutlinedIcon
              sx={{
                fontSize: 14
              }} />
            
              <Typography variant="caption">
                {multiFunctionEntities > 0 ?
              `${multiFunctionEntities} of ${entities.length} entities perform more than one function and are split into separate columns (revenue apportioned evenly across functions).` :
              'When an entity performs more than one function, it will appear as a separate column per function. Revenue will be apportioned across functions.'}
              </Typography>
            </Stack>
          </Stack>
        }
      </Box>

      <Box
        sx={{
          overflowX: 'auto',
          border: '1px solid #E2E8F0',
          borderRadius: 1.5
        }}>
        
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: `minmax(280px, 320px) repeat(${columns.length}, minmax(170px, 1fr))`,
            minWidth: 280 + columns.length * 170
          }}>
          
          {/* Country banding row — shown in entity + function scopes */}
          {(scope === 'entity' || scope === 'function') &&
          countryBands.length > 0 &&
          <>
                <Box
              sx={{
                bgcolor: '#0F172A',
                p: 1.25,
                position: 'sticky',
                left: 0,
                zIndex: 3,
                borderBottom: '1px solid #1E293B'
              }} />
            
                {countryBands.map((band) =>
            <Box
              key={band.label + band.start}
              sx={{
                gridColumn: `span ${band.span}`,
                bgcolor: '#0F172A',
                color: 'white',
                p: 1.25,
                borderLeft: '1px solid #1E293B'
              }}>
              
                    <Stack direction="row" alignItems="center" spacing={0.75}>
                      <PublicIcon
                  sx={{
                    fontSize: 14,
                    color: '#60A5FA'
                  }} />
                
                      <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 700,
                    color: 'white'
                  }}>
                  
                        {band.label}
                      </Typography>
                      <Chip
                  label={`${band.span} col${band.span === 1 ? '' : 's'}`}
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: 10,
                    bgcolor: '#1E293B',
                    color: '#94A3B8'
                  }} />
                
                    </Stack>
                  </Box>
            )}
              </>
          }

          {/* Entity banding row — only in function scope */}
          {scope === 'function' && entityBands.length > 0 &&
          <>
              <Box
              sx={{
                bgcolor: '#1E293B',
                p: 1.25,
                position: 'sticky',
                left: 0,
                zIndex: 3,
                borderBottom: '1px solid #334155'
              }} />
            
              {entityBands.map((band) =>
            <Box
              key={band.entityId + band.start}
              sx={{
                gridColumn: `span ${band.span}`,
                bgcolor: '#1E293B',
                color: 'white',
                p: 1.25,
                borderLeft: '1px solid #334155'
              }}>
              
                  <Stack direction="row" alignItems="center" spacing={0.75}>
                    <BusinessIcon
                  sx={{
                    fontSize: 13,
                    color: '#94A3B8'
                  }} />
                
                    <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 700,
                    color: 'white'
                  }}>
                  
                      {band.entityId}
                    </Typography>
                    <Typography
                  variant="caption"
                  sx={{
                    color: '#94A3B8'
                  }}
                  noWrap>
                  
                      {band.entityName}
                    </Typography>
                    {band.span > 1 &&
                <Chip
                  label={`${band.span} functions`}
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: 10,
                    bgcolor: '#2563EB',
                    color: 'white',
                    fontWeight: 700
                  }} />

                }
                  </Stack>
                </Box>
            )}
            </>
          }

          {/* Column header row */}
          <HeaderCell sticky>
            <Typography
              variant="caption"
              sx={{
                fontWeight: 700,
                color: '#475569',
                textTransform: 'uppercase',
                letterSpacing: '0.04em'
              }}>
              
              GL Account
            </Typography>
          </HeaderCell>
          {columns.map((c) =>
          <HeaderCell key={c.id} align="right">
              {scope === 'country' &&
            <Box>
                  <Stack
                direction="row"
                alignItems="center"
                spacing={0.5}
                sx={{
                  mb: 0.25,
                  justifyContent: 'flex-end'
                }}>
                
                    <PublicIcon
                  sx={{
                    fontSize: 14,
                    color: '#2563EB'
                  }} />
                
                    <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 700
                  }}>
                  
                      {c.label}
                    </Typography>
                  </Stack>
                  <Stack
                direction="row"
                spacing={0.5}
                flexWrap="wrap"
                useFlexGap
                justifyContent="flex-end">
                
                    <Chip
                  label={c.sublabel}
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: 10,
                    bgcolor: '#F1F5F9',
                    color: '#475569'
                  }} />
                
                    {c.functionName &&
                <Chip
                  label={`Primary: ${c.functionName}`}
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: 10,
                    bgcolor: '#EFF6FF',
                    color: '#1D4ED8'
                  }} />

                }
                  </Stack>
                </Box>
            }
              {scope === 'entity' &&
            <Box>
                  <Typography
                variant="body2"
                sx={{
                  fontWeight: 700,
                  lineHeight: 1.15
                }}
                noWrap>
                
                    {c.label}
                  </Typography>
                  <Typography
                variant="caption"
                sx={{
                  color: '#64748B',
                  display: 'block',
                  lineHeight: 1.25
                }}
                noWrap>
                
                    {c.sublabel}
                  </Typography>
                  {c.functionName &&
              <Stack
                direction="row"
                spacing={0.5}
                sx={{
                  mt: 0.5,
                  justifyContent: 'flex-end'
                }}
                flexWrap="wrap"
                useFlexGap>
                
                      <Chip
                  icon={
                  <CategoryIcon
                    sx={{
                      fontSize: 11
                    }} />

                  }
                  label={c.functionName}
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: 10,
                    bgcolor: '#F1F5F9',
                    color: '#475569',
                    '& .MuiChip-icon': {
                      ml: 0.5,
                      color: '#64748B'
                    }
                  }} />
                
                    </Stack>
              }
                </Box>
            }
              {scope === 'function' &&
            <Box>
                  <Stack
                direction="row"
                alignItems="center"
                spacing={0.5}
                sx={{
                  mb: 0.25,
                  justifyContent: 'flex-end'
                }}>
                
                    <CategoryIcon
                  sx={{
                    fontSize: 13,
                    color: '#2563EB'
                  }} />
                
                    <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 700,
                    lineHeight: 1.15
                  }}
                  noWrap>
                  
                      {c.functionName}
                    </Typography>
                  </Stack>
                  <Typography
                variant="caption"
                sx={{
                  color: '#64748B',
                  display: 'block',
                  lineHeight: 1.25
                }}
                noWrap>
                
                    {c.sublabel}
                  </Typography>
                </Box>
            }
            </HeaderCell>
          )}

          <SectionHeader cols={columns.length} label="Revenue" />
          {accounts.
          filter((a) => a.section === 'revenue').
          map((a) =>
          <RowGroup
            key={a.id}
            account={a}
            columns={columns}
            matrix={matrix}
            onChange={updateCell} />

          )}
          <SubtotalRow
            label="Total revenue"
            columns={columns}
            values={columns.map((c) => calc[c.id].totalRev)} />
          

          <SectionHeader cols={columns.length} label="Cost of goods sold" />
          {accounts.
          filter((a) => a.section === 'cogs').
          map((a) =>
          <RowGroup
            key={a.id}
            account={a}
            columns={columns}
            matrix={matrix}
            onChange={updateCell} />

          )}
          <SubtotalRow
            label="Total COGS"
            columns={columns}
            values={columns.map((c) => calc[c.id].totalCogs)} />
          
          <SubtotalRow
            label="Gross profit"
            columns={columns}
            values={columns.map((c) => calc[c.id].grossProfit)}
            secondary={columns.map(
              (c) => `${calc[c.id].grossMargin.toFixed(1)}% GM`
            )}
            emphasis />
          

          <SectionHeader cols={columns.length} label="Operating expenses" />
          {accounts.
          filter((a) => a.section === 'opex').
          map((a) =>
          <RowGroup
            key={a.id}
            account={a}
            columns={columns}
            matrix={matrix}
            onChange={updateCell} />

          )}
          <SubtotalRow
            label="Total OPEX"
            columns={columns}
            values={columns.map((c) => calc[c.id].totalOpex)} />
          

          <SubtotalRow
            label="Operating profit"
            columns={columns}
            values={columns.map((c) => calc[c.id].operatingProfit)}
            emphasis
            strong />
          
          <SubtotalRow
            label="Operating margin (OM %)"
            columns={columns}
            values={columns.map((c) => calc[c.id].operatingMargin)}
            isPercent
            colorByValue />
          

          <SectionHeader cols={columns.length} label="Tax" />
          {accounts.
          filter((a) => a.section === 'tax').
          map((a) =>
          <RowGroup
            key={a.id}
            account={a}
            columns={columns}
            matrix={matrix}
            onChange={updateCell} />

          )}
          <SubtotalRow
            label="Net income"
            columns={columns}
            values={columns.map((c) => calc[c.id].netIncome)}
            emphasis
            strong />
          
        </Box>
      </Box>

      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{
          mt: 1.5
        }}>
        
        <Box
          sx={{
            width: 10,
            height: 10,
            bgcolor: '#FAFCFF',
            border: '1px solid #BFDBFE',
            borderRadius: 0.5
          }} />
        
        <Typography
          variant="caption"
          sx={{
            color: '#64748B'
          }}>
          
          Editable input
        </Typography>
        <Box
          sx={{
            width: 10,
            height: 10,
            bgcolor: '#F1F5F9',
            borderRadius: 0.5,
            ml: 2
          }} />
        
        <Typography
          variant="caption"
          sx={{
            color: '#64748B'
          }}>
          
          Calculated subtotal
        </Typography>
      </Stack>
    </Paper>);

}
// --- helpers to build banding rows ---
function buildCountryBands(cols: ColumnDef[]): {
  start: number;
  span: number;
  label: string;
}[] {
  const bands: {
    start: number;
    span: number;
    label: string;
  }[] = [];
  let i = 0;
  while (i < cols.length) {
    const cc = cols[i].countryCode!;
    let j = i;
    while (j < cols.length && cols[j].countryCode === cc) j++;
    bands.push({
      start: i,
      span: j - i,
      label: countryNames[cc] || cc
    });
    i = j;
  }
  return bands;
}
function buildEntityBands(cols: ColumnDef[]): {
  start: number;
  span: number;
  entityId: string;
  entityName: string;
}[] {
  const bands: {
    start: number;
    span: number;
    entityId: string;
    entityName: string;
  }[] = [];
  let i = 0;
  while (i < cols.length) {
    const eid = cols[i].entityId!;
    let j = i;
    while (j < cols.length && cols[j].entityId === eid) j++;
    bands.push({
      start: i,
      span: j - i,
      entityId: eid,
      entityName: cols[i].entityName || ''
    });
    i = j;
  }
  return bands;
}
function HierarchyStep({
  icon,
  label,
  active,
  onClick





}: {icon: React.ReactNode;label: string;active?: boolean;onClick?: () => void;}) {
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.25,
        py: 0.5,
        borderRadius: 1,
        bgcolor: active ? '#2563EB' : 'white',
        color: active ? 'white' : '#334155',
        border: '1px solid',
        borderColor: active ? '#2563EB' : '#CBD5E1',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: 13,
        '&:hover': !active ?
        {
          borderColor: '#2563EB',
          color: '#1D4ED8'
        } :
        undefined
      }}>
      
      {icon}
      <span>{label}</span>
    </Box>);

}
function HeaderCell({
  children,
  sticky,
  align




}: {children: React.ReactNode;sticky?: boolean;align?: 'left' | 'right';}) {
  return (
    <Box
      sx={{
        p: 1.25,
        bgcolor: '#F8FAFC',
        borderBottom: '2px solid #E2E8F0',
        position: sticky ? 'sticky' : 'static',
        left: sticky ? 0 : undefined,
        zIndex: sticky ? 2 : 1,
        textAlign: align === 'right' ? 'right' : 'left'
      }}>
      
      {children}
    </Box>);

}
function SectionHeader({ cols, label }: {cols: number;label: string;}) {
  return (
    <Box
      sx={{
        gridColumn: `span ${cols + 1}`,
        bgcolor: '#F1F5F9',
        borderTop: '1px solid #E2E8F0',
        borderBottom: '1px solid #E2E8F0',
        px: 1.5,
        py: 0.75
      }}>
      
      <Typography
        variant="caption"
        sx={{
          fontWeight: 800,
          color: '#0F172A',
          textTransform: 'uppercase',
          letterSpacing: '0.06em'
        }}>
        
        {label}
      </Typography>
    </Box>);

}
interface RowGroupProps {
  account: Account;
  columns: ColumnDef[];
  matrix: Matrix;
  onChange: (colId: string, accountId: string, value: number) => void;
}
function RowGroup({ account, columns, matrix, onChange }: RowGroupProps) {
  return (
    <>
      <Box
        sx={{
          p: 1.25,
          bgcolor: 'white',
          borderBottom: '1px solid #F1F5F9',
          position: 'sticky',
          left: 0,
          zIndex: 1
        }}>
        
        <Typography
          variant="body2"
          sx={{
            color: '#334155',
            pl: (account.indent || 0) * 2
          }}>
          
          {account.label}
        </Typography>
      </Box>
      {columns.map((c) =>
      <EditableCell
        key={c.id}
        value={matrix[c.id]?.[account.id] ?? 0}
        onChange={(v) => onChange(c.id, account.id, v)} />

      )}
    </>);

}
function EditableCell({
  value,
  onChange



}: {value: number;onChange: (v: number) => void;}) {
  const [raw, setRaw] = useState<string>('');
  const [focused, setFocused] = useState(false);
  const display = focused ? raw : fmt(value);
  return (
    <Box
      sx={{
        p: 0.5,
        borderBottom: '1px solid #F1F5F9',
        bgcolor: '#FAFCFF'
      }}>
      
      <TextField
        size="small"
        value={focused ? raw : display}
        onFocus={() => {
          setFocused(true);
          setRaw(String(value));
        }}
        onBlur={() => {
          const n = Number(raw.replace(/[^0-9.-]/g, ''));
          if (!isNaN(n)) onChange(n);
          setFocused(false);
        }}
        onChange={(e) => setRaw(e.target.value)}
        variant="outlined"
        inputProps={{
          style: {
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
            padding: '6px 8px',
            fontSize: 13
          },
          'aria-label': 'Edit value'
        }}
        sx={{
          width: '100%',
          '& .MuiOutlinedInput-root': {
            bgcolor: focused ? '#EFF6FF' : 'transparent',
            '& fieldset': {
              borderColor: focused ? '#2563EB' : 'transparent'
            },
            '&:hover fieldset': {
              borderColor: '#CBD5E1'
            }
          }
        }} />
      
    </Box>);

}
interface SubtotalRowProps {
  label: string;
  columns: ColumnDef[];
  values: number[];
  secondary?: string[];
  emphasis?: boolean;
  strong?: boolean;
  isPercent?: boolean;
  colorByValue?: boolean;
}
function SubtotalRow({
  label,
  columns,
  values,
  secondary,
  emphasis,
  strong,
  isPercent,
  colorByValue
}: SubtotalRowProps) {
  const bg = strong ? '#E2E8F0' : emphasis ? '#F1F5F9' : '#F8FAFC';
  const weight = strong ? 800 : 700;
  return (
    <>
      <Box
        sx={{
          p: 1.25,
          bgcolor: bg,
          borderTop: '1px solid #E2E8F0',
          borderBottom: '1px solid #E2E8F0',
          position: 'sticky',
          left: 0,
          zIndex: 1
        }}>
        
        <Typography
          variant="body2"
          sx={{
            fontWeight: weight,
            color: '#0F172A'
          }}>
          
          {label}
        </Typography>
      </Box>
      {columns.map((c, i) => {
        const v = values[i];
        let color = '#0F172A';
        if (colorByValue) {
          if (v >= 4 && v <= 7) color = '#16A34A';else
          if (v > 7 && v < 12) color = '#D97706';else
          if (v > 12 || v < 4) color = '#DC2626';
        }
        return (
          <Box
            key={c.id}
            sx={{
              p: 1.25,
              bgcolor: bg,
              borderTop: '1px solid #E2E8F0',
              borderBottom: '1px solid #E2E8F0',
              textAlign: 'right'
            }}>
            
            <Typography
              variant="body2"
              sx={{
                fontWeight: weight,
                color,
                fontVariantNumeric: 'tabular-nums'
              }}>
              
              {isPercent ? `${v.toFixed(1)}%` : fmt(v)}
            </Typography>
            {secondary &&
            <Typography
              variant="caption"
              sx={{
                color: '#64748B'
              }}>
              
                {secondary[i]}
              </Typography>
            }
          </Box>);

      })}
    </>);

}