import React, { useMemo, useState } from 'react';
import AppShell from '../components/layout/AppShell';
import {
  Paper,
  Typography,
  Box,
  Grid,
  Stack,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Slider,
  Button,
  Divider,
  ToggleButton,
  ToggleButtonGroup,
  Tabs,
  Tab } from
'@mui/material';
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  CartesianGrid,
  Legend } from
'recharts';
import {
  statusColor,
  statusLabel,
  EntityStatus } from
'../components/data/entities';
import { useEntities } from '../data/DataProvider';
import { formatCurrency } from '../components/theme';
import DetailedPnL from '../components/pnl/DetailedPnL';
// Worst status wins for jurisdiction-level rollup
const statusRank: Record<EntityStatus, number> = {
  'in-range': 0,
  watch: 1,
  'out-of-range': 2
};
const rankStatus: EntityStatus[] = ['in-range', 'watch', 'out-of-range'];
export default function SegmentedPnL() {
  const [tab, setTab] = useState(0);
  const [shift, setShift] = useState(0);
  const [view, setView] = useState<'entity' | 'jurisdiction'>('entity');
  const entities = useEntities();
  const segments = useMemo(
    () => entities.map((e) => {
      const revenue = e.ytdVolume;
      const opMargin = e.actualMargin ?? 8;
      const operatingProfit = Math.round(revenue * (opMargin / 100));
      const costs = revenue - operatingProfit;
      const etr = 22 + Math.round(e.lat % 5 * 2);
      return {
        id: e.id,
        name: e.name,
        country: e.country,
        countryCode: e.countryCode,
        function: e.function,
        revenue,
        costs,
        operatingProfit,
        opMargin,
        etr,
        status: e.status,
      };
    }),
    [entities]
  );
  const scenarioSegments = useMemo(
    () =>
    segments.map((s) => {
      const newMargin = s.opMargin + shift;
      const newProfit = Math.round(s.revenue * (newMargin / 100));
      return {
        ...s,
        scenarioMargin: newMargin,
        scenarioProfit: newProfit
      };
    }),
    [shift, segments]
  );
  const byJurisdiction = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        country: string;
        countryCode: string;
        function: string;
        revenue: number;
        costs: number;
        operatingProfit: number;
        scenarioProfit: number;
        opMargin: number;
        scenarioMargin: number;
        etr: number;
        entityCount: number;
        status: EntityStatus;
        statusRankValue: number;
      }>(
    );
    scenarioSegments.forEach((s) => {
      const prev = map.get(s.countryCode);
      if (!prev) {
        map.set(s.countryCode, {
          id: s.countryCode,
          name: s.country,
          country: s.country,
          countryCode: s.countryCode,
          function: '—',
          revenue: s.revenue,
          costs: s.costs,
          operatingProfit: s.operatingProfit,
          scenarioProfit: s.scenarioProfit,
          opMargin: 0,
          scenarioMargin: 0,
          etr: s.etr,
          entityCount: 1,
          status: s.status,
          statusRankValue: statusRank[s.status]
        });
      } else {
        prev.revenue += s.revenue;
        prev.costs += s.costs;
        prev.operatingProfit += s.operatingProfit;
        prev.scenarioProfit += s.scenarioProfit;
        prev.etr = Math.round(
          (prev.etr * prev.entityCount + s.etr) / (prev.entityCount + 1)
        );
        prev.entityCount += 1;
        if (statusRank[s.status] > prev.statusRankValue) {
          prev.statusRankValue = statusRank[s.status];
          prev.status = s.status;
        }
      }
    });
    // Derive blended margins
    return Array.from(map.values()).map((j) => ({
      ...j,
      opMargin: Math.round(j.operatingProfit / j.revenue * 1000) / 10,
      scenarioMargin: Math.round(j.scenarioProfit / j.revenue * 1000) / 10
    }));
  }, [scenarioSegments]);
  const chartData = view === 'entity' ? scenarioSegments : byJurisdiction;
  const chartXKey = view === 'entity' ? 'id' : 'countryCode';
  const chartKey = view === 'entity' ? 'operatingProfit' : 'profit';
  const tableRows = view === 'entity' ? scenarioSegments : byJurisdiction;
  // Use consistent key for chart bars
  const chartDataNormalized = chartData.map((d) => ({
    label: (d as any)[chartXKey],
    name: (d as any).name || (d as any).id,
    currentProfit:
    view === 'entity' ?
    (d as any).operatingProfit :
    (d as any).operatingProfit,
    scenarioProfit: (d as any).scenarioProfit
  }));
  const totalICRev = scenarioSegments.reduce((a, s) => a + s.revenue, 0);
  // Total group revenue includes external (third-party) revenue plus intercompany.
  const totalRev = Math.round(totalICRev * 1.85);
  const totalProfit = scenarioSegments.reduce(
    (a, s) => a + s.operatingProfit,
    0
  );
  const scenarioTotalProfit = scenarioSegments.reduce(
    (a, s) => a + s.scenarioProfit,
    0
  );
  const blendedETR = 24.3;
  return (
    <AppShell pageTitle="Segmented P&L">
      <Box
        sx={{
          borderBottom: '1px solid #E2E8F0',
          mb: 2.5
        }}>
        
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab label="Overview" />
          <Tab label="Detailed financials" />
        </Tabs>
      </Box>

      {tab === 0 &&
      <Grid container spacing={2.5}>
          <Grid item xs={12} sm={6} md={2.4}>
            <Paper
            sx={{
              p: 2.5,
              height: '100%'
            }}>
            
              <Typography
              variant="caption"
              sx={{
                color: '#64748B',
                fontWeight: 600,
                textTransform: 'uppercase'
              }}>
              
                Total Revenue
              </Typography>
              <Typography
              variant="h5"
              sx={{
                fontWeight: 800
              }}>
              
                {formatCurrency(totalRev, 'USD', true)}
              </Typography>
              <Typography
              variant="caption"
              sx={{
                color: '#94A3B8'
              }}>
              
                Group-wide incl. external
              </Typography>
            </Paper>
          </Grid>
          <Grid item xs={12} sm={6} md={2.4}>
            <Paper
            sx={{
              p: 2.5,
              height: '100%'
            }}>
            
              <Typography
              variant="caption"
              sx={{
                color: '#64748B',
                fontWeight: 600,
                textTransform: 'uppercase'
              }}>
              
                Total IC Revenue
              </Typography>
              <Typography
              variant="h5"
              sx={{
                fontWeight: 800
              }}>
              
                {formatCurrency(totalICRev, 'USD', true)}
              </Typography>
              <Typography
              variant="caption"
              sx={{
                color: '#94A3B8'
              }}>
              
                Intercompany only
              </Typography>
            </Paper>
          </Grid>
          <Grid item xs={12} sm={6} md={2.4}>
            <Paper
            sx={{
              p: 2.5,
              height: '100%'
            }}>
            
              <Typography
              variant="caption"
              sx={{
                color: '#64748B',
                fontWeight: 600,
                textTransform: 'uppercase'
              }}>
              
                Operating Profit
              </Typography>
              <Typography
              variant="h5"
              sx={{
                fontWeight: 800
              }}>
              
                {formatCurrency(totalProfit, 'USD', true)}
              </Typography>
            </Paper>
          </Grid>
          <Grid item xs={12} sm={6} md={2.4}>
            <Paper
            sx={{
              p: 2.5,
              height: '100%'
            }}>
            
              <Typography
              variant="caption"
              sx={{
                color: '#64748B',
                fontWeight: 600,
                textTransform: 'uppercase'
              }}>
              
                Scenario Profit (shift {shift > 0 ? `+${shift}` : shift}pp)
              </Typography>
              <Typography
              variant="h5"
              sx={{
                fontWeight: 800,
                color: shift !== 0 ? '#2563EB' : '#0F172A'
              }}>
              
                {formatCurrency(scenarioTotalProfit, 'USD', true)}
              </Typography>
            </Paper>
          </Grid>
          <Grid item xs={12} sm={6} md={2.4}>
            <Paper
            sx={{
              p: 2.5,
              height: '100%'
            }}>
            
              <Typography
              variant="caption"
              sx={{
                color: '#64748B',
                fontWeight: 600,
                textTransform: 'uppercase'
              }}>
              
                Blended Group ETR
              </Typography>
              <Typography
              variant="h5"
              sx={{
                fontWeight: 800
              }}>
              
                {blendedETR.toFixed(1)}%
              </Typography>
            </Paper>
          </Grid>

          <Grid
          item
          xs={12}
          sx={{
            width: '100%'
          }}>
          
            <Paper
            sx={{
              p: 2.5,
              width: '100%'
            }}>
            
              <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 700,
                mb: 1
              }}>
              
                ETR scenario modeling
              </Typography>
              <Typography
              variant="caption"
              sx={{
                color: '#64748B'
              }}>
              
                Shift target margin allocation by ±3pp and see the downstream
                impact on profit and ETR.
              </Typography>
              <Box
              sx={{
                px: 1,
                mt: 3,
                maxWidth: 720
              }}>
              
                <Slider
                value={shift}
                onChange={(_, v) => setShift(v as number)}
                min={-3}
                max={3}
                step={0.5}
                marks
                valueLabelDisplay="on"
                valueLabelFormat={(v) => `${v > 0 ? '+' : ''}${v}pp`}
                sx={{
                  color: '#2563EB'
                }} />
              
              </Box>
              <Divider
              sx={{
                my: 2
              }} />
            
              <Stack direction="row" spacing={1}>
                <Button
                variant="outlined"
                size="small"
                onClick={() => setShift(0)}>
                
                  Reset
                </Button>
                <Button variant="contained" size="small">
                  Save scenario
                </Button>
              </Stack>
            </Paper>
          </Grid>

          <Grid
          item
          xs={12}
          sx={{
            width: '100%'
          }}>
          
            <Paper
            sx={{
              p: 2.5,
              width: '100%'
            }}>
            
              <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{
                mb: 1.5
              }}>
              
                <Typography
                variant="subtitle1"
                sx={{
                  fontWeight: 700
                }}>
                
                  Profit {view === 'entity' ? 'by entity' : 'by jurisdiction'}
                </Typography>
                <ToggleButtonGroup
                size="small"
                value={view}
                exclusive
                onChange={(_, v) => v && setView(v)}>
                
                  <ToggleButton value="entity">By entity</ToggleButton>
                  <ToggleButton value="jurisdiction">
                    By jurisdiction
                  </ToggleButton>
                </ToggleButtonGroup>
              </Stack>
              <Box
              sx={{
                width: '100%',
                height: 380
              }}>
              
                <ResponsiveContainer>
                  <BarChart
                  data={chartDataNormalized}
                  margin={{
                    top: 8,
                    right: 16,
                    left: 0,
                    bottom: 8
                  }}>
                  
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis
                    dataKey="label"
                    fontSize={11}
                    interval={0}
                    angle={view === 'entity' ? -40 : 0}
                    textAnchor={view === 'entity' ? 'end' : 'middle'}
                    height={view === 'entity' ? 72 : 30} />
                  
                    <YAxis
                    fontSize={12}
                    tickFormatter={(v) => `$${(v / 1e6).toFixed(0)}M`} />
                  
                    <ReTooltip
                    formatter={(v: any) =>
                    formatCurrency(v as number, 'USD', true)
                    } />
                  
                    <Legend
                    wrapperStyle={{
                      fontSize: 12
                    }} />
                  
                    <Bar
                    dataKey="currentProfit"
                    fill="#94A3B8"
                    name="Current profit"
                    radius={[4, 4, 0, 0]} />
                  
                    <Bar
                    dataKey="scenarioProfit"
                    fill="#2563EB"
                    name="Scenario profit"
                    radius={[4, 4, 0, 0]} />
                  
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </Paper>
          </Grid>

          <Grid item xs={12}>
            <Paper
            sx={{
              p: 2.5
            }}>
            
              <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{
                mb: 2
              }}>
              
                <Typography
                variant="subtitle1"
                sx={{
                  fontWeight: 700
                }}>
                
                  Segmented P&L —{' '}
                  {view === 'entity' ? 'by entity' : 'by jurisdiction'}
                </Typography>
                <Typography
                variant="caption"
                sx={{
                  color: '#64748B'
                }}>
                
                  {view === 'entity' ?
                `${tableRows.length} entities` :
                `${tableRows.length} jurisdictions`}
                </Typography>
              </Stack>
              <Box
              sx={{
                overflowX: 'auto'
              }}>
              
                <Table
                size="small"
                sx={{
                  minWidth: 900
                }}>
                
                  <TableHead>
                    <TableRow>
                      <TableCell>
                        {view === 'entity' ? 'Entity' : 'Jurisdiction'}
                      </TableCell>
                      <TableCell>Country</TableCell>
                      <TableCell>
                        {view === 'entity' ? 'Function' : 'Entities'}
                      </TableCell>
                      <TableCell align="right">IC Revenue</TableCell>
                      <TableCell align="right">Costs</TableCell>
                      <TableCell align="right">Operating Profit</TableCell>
                      <TableCell align="right">OM %</TableCell>
                      <TableCell align="right">Scenario OM %</TableCell>
                      <TableCell align="right">ETR</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tableRows.map((s: any) =>
                  <TableRow key={s.id} hover>
                        <TableCell
                      sx={{
                        fontWeight: 700
                      }}>
                      
                          {view === 'entity' ? s.id : s.country}
                        </TableCell>
                        <TableCell>{s.countryCode}</TableCell>
                        <TableCell>
                          {view === 'entity' ?
                      s.function :
                      `${s.entityCount} ${s.entityCount === 1 ? 'entity' : 'entities'}`}
                        </TableCell>
                        <TableCell align="right">
                          {formatCurrency(s.revenue, 'USD', true)}
                        </TableCell>
                        <TableCell align="right">
                          {formatCurrency(s.costs, 'USD', true)}
                        </TableCell>
                        <TableCell align="right">
                          {formatCurrency(s.operatingProfit, 'USD', true)}
                        </TableCell>
                        <TableCell align="right">{s.opMargin}%</TableCell>
                        <TableCell
                      align="right"
                      sx={{
                        color: shift !== 0 ? '#2563EB' : '#475569',
                        fontWeight: shift !== 0 ? 700 : 400
                      }}>
                      
                          {s.scenarioMargin}%
                        </TableCell>
                        <TableCell align="right">{s.etr}%</TableCell>
                        <TableCell>
                          <Chip
                        label={statusLabel[s.status as EntityStatus]}
                        size="small"
                        sx={{
                          bgcolor: `${statusColor[s.status as EntityStatus]}18`,
                          color: statusColor[s.status as EntityStatus],
                          fontWeight: 700
                        }} />
                      
                        </TableCell>
                      </TableRow>
                  )}
                  </TableBody>
                </Table>
              </Box>
            </Paper>
          </Grid>
        </Grid>
      }

      {tab === 1 && <DetailedPnL />}
    </AppShell>);

}