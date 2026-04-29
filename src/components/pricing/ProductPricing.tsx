import React, { useMemo, useState } from 'react';
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
  LinearProgress,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Alert } from
'@mui/material';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  BarChart } from
'recharts';
import { useBerryTrend } from '../../data/DataProvider';
import { useEntities } from '../../data/DataProvider';
import { formatCurrency } from '../theme';
// Monthly Base Income + Operating Margin data — REPLACED by /api/berry; kept for reference
const _legacyMonthlyData = [
{
  month: 'Jan',
  income: 1435.3,
  berry: 1.24,
  target: 1.26
},
{
  month: 'Feb',
  income: 1435.3,
  berry: 1.24,
  target: 1.26
},
{
  month: 'Mar',
  income: 1466.1,
  berry: 1.17,
  target: 1.26
},
{
  month: 'Apr',
  income: 1197.8,
  berry: 1.14,
  target: 1.26
},
{
  month: 'May',
  income: 1310.0,
  berry: 1.16,
  target: 1.26
},
{
  month: 'Jun',
  income: 1668.8,
  berry: 1.2,
  target: 1.26
},
{
  month: 'Jul',
  income: 2494.5,
  berry: 1.3,
  target: 1.26
},
{
  month: 'Aug',
  income: 2581.4,
  berry: 1.3,
  target: 1.26
},
{
  month: 'Sep',
  income: 2580.3,
  berry: 1.3,
  target: 1.26
},
{
  month: 'Oct',
  income: 2641.8,
  berry: 1.3,
  target: 1.26
},
{
  month: 'Nov',
  income: 2845.6,
  berry: 1.26,
  target: 1.26
},
{
  month: 'Dec',
  income: 1666.5,
  berry: 1.2,
  target: 1.26
}];

// Operating Margin variance by country (entity)
const countryVariance = [
{
  country: 'El Salvador',
  actual: 1.26,
  simulation: 1.33
},
{
  country: 'Honduras',
  actual: 1.35,
  simulation: 1.36
},
{
  country: 'Panama',
  actual: 1.28,
  simulation: 1.26
},
{
  country: 'Puerto Rico',
  actual: 1.17,
  simulation: 1.17
},
{
  country: 'Guatemala',
  actual: 1.28,
  simulation: 1.28
},
{
  country: 'Ecuador',
  actual: 1.08,
  simulation: 1.08
}];

// Operating Margin variance per product
const productVariance = [
{
  product: 'Product 1',
  actual: 1.26,
  simulation: 1.36
},
{
  product: 'Product 2',
  actual: 1.24,
  simulation: 1.31
},
{
  product: 'Product 3',
  actual: 1.05,
  simulation: 1.09
},
{
  product: 'Product 4',
  actual: 1.3,
  simulation: 1.36
},
{
  product: 'Product 5',
  actual: 1.18,
  simulation: 1.23
}];

// Current vs New markup by country/product
const markupData = [
{
  country: 'El Salvador',
  products: [
  {
    name: 'Product 1',
    current: 51.0,
    proposed: 55.5
  },
  {
    name: 'Product 2',
    current: 33.0,
    proposed: 31.1
  },
  {
    name: 'Product 3',
    current: 2.0,
    proposed: -9.2
  },
  {
    name: 'Product 4',
    current: 57.0,
    proposed: 57.4
  },
  {
    name: 'Product 5',
    current: 17.0,
    proposed: 27.3
  }]

},
{
  country: 'Honduras',
  products: [
  {
    name: 'Product 1',
    current: 25.0,
    proposed: 31.5
  },
  {
    name: 'Product 2',
    current: 19.0,
    proposed: 29.4
  },
  {
    name: 'Product 3',
    current: 9.0,
    proposed: 5.2
  },
  {
    name: 'Product 4',
    current: 18.0,
    proposed: 60.4
  },
  {
    name: 'Product 5',
    current: 24.0,
    proposed: 33.0
  }]

},
{
  country: 'Panama',
  products: [
  {
    name: 'Product 1',
    current: 27.0,
    proposed: 41.1
  },
  {
    name: 'Product 2',
    current: 20.0,
    proposed: 36.2
  },
  {
    name: 'Product 3',
    current: 26.0,
    proposed: 1.2
  },
  {
    name: 'Product 4',
    current: 99.0,
    proposed: 83.3
  },
  {
    name: 'Product 5',
    current: 2.0,
    proposed: 31.4
  }]

},
{
  country: 'Puerto Rico',
  products: [
  {
    name: 'Product 1',
    current: 46.0,
    proposed: 56.6
  },
  {
    name: 'Product 2',
    current: 30.0,
    proposed: 25.3
  },
  {
    name: 'Product 3',
    current: 13.0,
    proposed: 8.3
  },
  {
    name: 'Product 4',
    current: 19.0,
    proposed: 37.6
  },
  {
    name: 'Product 5',
    current: 22.0,
    proposed: 26.5
  }]

},
{
  country: 'Guatemala',
  products: [
  {
    name: 'Product 1',
    current: 22.0,
    proposed: 29.7
  },
  {
    name: 'Product 2',
    current: 12.0,
    proposed: 17.6
  },
  {
    name: 'Product 3',
    current: 15.0,
    proposed: 6.1
  },
  {
    name: 'Product 4',
    current: 28.0,
    proposed: 34.2
  },
  {
    name: 'Product 5',
    current: 20.0,
    proposed: 24.5
  }]

}];

const KpiCard = ({
  label,
  value,
  delta,
  subtitle





}: {label: string;value: string;delta: string;subtitle: string;}) =>
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
    
      {label}
    </Typography>
    <Typography
    variant="caption"
    sx={{
      display: 'block',
      color: '#94A3B8'
    }}>
    
      {subtitle}
    </Typography>
    <Stack
    direction="row"
    alignItems="baseline"
    spacing={1}
    sx={{
      mt: 1
    }}>
    
      <Typography
      variant="h4"
      sx={{
        fontWeight: 800,
        color: '#0F172A'
      }}>
      
        {value}
      </Typography>
      <Typography
      variant="caption"
      sx={{
        color: '#DC2626',
        fontWeight: 600
      }}>
      
        ({delta})
      </Typography>
    </Stack>
    <Typography
    variant="caption"
    sx={{
      color: '#94A3B8',
      display: 'block',
      mt: 0.5
    }}>
    
      FY21 Total − FY21 Simulation
    </Typography>
  </Paper>;

export default function ProductPricing() {
  const entities = useEntities();
  // Berry analysis is most meaningful for distributors and toll mfrs; default to UK LRD
  const defaultEntity = useMemo(
    () => (entities.find((e) => e.id === '3300') ? '3300' : entities[0]?.id),
    [entities]
  );
  const [entityId, setEntityId] = useState<string>(defaultEntity ?? '3300');
  const trend = useBerryTrend({ entity: entityId });

  // YTD aggregates derived from the live monthly trend
  const totals = useMemo(() => {
    if (!trend.data || trend.data.length === 0)
      return { revenue: 0, gp: 0, opex: 0, avgBerry: 0, target: 1.2 };
    const revenue = trend.data.reduce((a, r) => a + r.revenue, 0);
    const gp = trend.data.reduce((a, r) => a + r.gp, 0);
    const opex = trend.data.reduce((a, r) => a + r.opex, 0);
    const avgBerry = opex > 0 ? gp / opex : 0;
    const target = trend.data[0].target;
    return { revenue, gp, opex, avgBerry, target };
  }, [trend.data]);

  const selectedEntity = entities.find((e) => e.id === entityId);
  const currency = selectedEntity?.currency ?? 'USD';
  const variance = totals.avgBerry - totals.target;

  return (
    <Box>
      {/* Top row: KPIs + Monthly chart */}
      <Grid
        container
        spacing={2}
        sx={{
          mb: 2.5
        }}>

        <Grid item xs={12} md={3}>
          <Stack spacing={2}>
            <KpiCard
              label="YTD Revenue"
              subtitle={`${selectedEntity?.id ?? ''} — ${currency}`}
              value={formatCurrency(totals.revenue, currency, true)}
              delta={trend.loading ? '…' : `${(totals.revenue / 1e6).toFixed(1)}M`} />

            <KpiCard
              label="Gross Profit (rev − COGS − IC)"
              subtitle={currency}
              value={formatCurrency(totals.gp, currency, true)}
              delta={
                totals.revenue > 0
                  ? `${((totals.gp / totals.revenue) * 100).toFixed(1)}% of rev`
                  : '—'
              } />

            <KpiCard
              label="OpEx (S,G&A)"
              subtitle={currency}
              value={formatCurrency(totals.opex, currency, true)}
              delta={
                totals.revenue > 0
                  ? `${((totals.opex / totals.revenue) * 100).toFixed(1)}% of rev`
                  : '—'
              } />

            <KpiCard
              label="YTD Berry ratio"
              subtitle={`Target ${totals.target.toFixed(2)}`}
              value={totals.avgBerry.toFixed(2)}
              delta={
                trend.loading
                  ? '…'
                  : `${variance >= 0 ? '+' : ''}${variance.toFixed(2)} vs target`
              } />

          </Stack>
        </Grid>
        <Grid item xs={12} md={9}>
          <Paper
            sx={{
              p: 2.5,
              height: '100%'
            }}>

            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="flex-end"
              sx={{ mb: 1, flexWrap: 'wrap', gap: 1.5 }}>
              <Box>
                <Typography
                  variant="subtitle1"
                  sx={{
                    fontWeight: 700
                  }}>
                  Monthly Berry-ratio analysis
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#64748B'
                  }}>
                  Bar: revenue ({currency}). Lines: Berry ratio (left) vs. arm's-length target.
                </Typography>
              </Box>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel id="berry-entity-label">Entity</InputLabel>
                <Select
                  labelId="berry-entity-label"
                  label="Entity"
                  value={entityId}
                  onChange={(e) => setEntityId(e.target.value as string)}>
                  {entities.map((e) => (
                    <MenuItem key={e.id} value={e.id}>
                      {e.id} — {e.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            {trend.loading ? (
              <Box sx={{ p: 4, textAlign: 'center' }}>
                <CircularProgress size={28} />
              </Box>
            ) : trend.error ? (
              <Alert severity="warning">{trend.error.message}</Alert>
            ) : (
              <Box
                sx={{
                  width: '100%',
                  height: 360,
                  mt: 1
                }}>

                <ResponsiveContainer>
                  <ComposedChart
                    data={trend.data ?? []}
                    margin={{
                      top: 10,
                      right: 10,
                      bottom: 0,
                      left: 0
                    }}>

                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis
                      dataKey="month"
                      tick={{
                        fontSize: 12,
                        fill: '#64748B'
                      }} />

                    <YAxis
                      yAxisId="left"
                      tickFormatter={(v: number) => `${(v / 1_000_000).toFixed(1)}M`}
                      tick={{
                        fontSize: 12,
                        fill: '#64748B'
                      }} />

                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{
                        fontSize: 12,
                        fill: '#64748B'
                      }} />

                    <Tooltip
                      formatter={(value: number, name: string) => {
                        if (name === 'Revenue') return formatCurrency(value, currency, true);
                        return value.toFixed(2);
                      }} />
                    <Legend
                      wrapperStyle={{
                        fontSize: 12
                      }} />

                    <ReferenceLine
                      yAxisId="right"
                      y={totals.target}
                      stroke="#F59E0B"
                      strokeDasharray="3 3" />

                    <Bar
                      yAxisId="left"
                      dataKey="revenue"
                      name="Revenue"
                      fill="#5EEAD4"
                      radius={[4, 4, 0, 0]} />

                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="target"
                      name="Target Berry"
                      stroke="#F59E0B"
                      strokeWidth={2}
                      dot={{
                        r: 3
                      }} />

                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="berry"
                      name="Actual Berry"
                      stroke="#1E293B"
                      strokeWidth={2}
                      dot={{
                        r: 4
                      }} />

                  </ComposedChart>
                </ResponsiveContainer>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Middle row: Variance charts */}
      <Grid
        container
        spacing={2}
        sx={{
          mb: 2.5
        }}>
        
        <Grid item xs={12} md={4}>
          <Paper
            sx={{
              p: 2.5,
              height: '100%'
            }}>
            
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 700
              }}>
              
              Operating Margin variance by Entity
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: '#64748B',
                display: 'block',
                mb: 1
              }}>
              
              FY21 Total vs FY21 Simulation
            </Typography>
            <Box
              sx={{
                width: '100%',
                height: 300
              }}>
              
              <ResponsiveContainer>
                <BarChart data={countryVariance}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis
                    dataKey="country"
                    tick={{
                      fontSize: 10,
                      fill: '#64748B'
                    }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={60} />
                  
                  <YAxis
                    domain={[0.9, 1.5]}
                    tick={{
                      fontSize: 11,
                      fill: '#64748B'
                    }} />
                  
                  <Tooltip />
                  <Legend
                    wrapperStyle={{
                      fontSize: 11
                    }} />
                  
                  <Bar
                    dataKey="actual"
                    name="FY21 Total"
                    fill="#0D9488"
                    radius={[4, 4, 0, 0]} />
                  
                  <Bar
                    dataKey="simulation"
                    name="FY21 Simulation"
                    fill="#99F6E4"
                    radius={[4, 4, 0, 0]} />
                  
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper
            sx={{
              p: 2.5,
              height: '100%'
            }}>
            
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 700
              }}>
              
              Operating Margin variance by Product
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: '#64748B',
                display: 'block',
                mb: 1
              }}>
              
              FY21 Total vs Simulation
            </Typography>
            <Box
              sx={{
                width: '100%',
                height: 300
              }}>
              
              <ResponsiveContainer>
                <BarChart
                  data={productVariance}
                  layout="vertical"
                  margin={{
                    left: 10
                  }}>
                  
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis
                    type="number"
                    domain={[0.9, 1.5]}
                    tick={{
                      fontSize: 11,
                      fill: '#64748B'
                    }} />
                  
                  <YAxis
                    type="category"
                    dataKey="product"
                    tick={{
                      fontSize: 11,
                      fill: '#64748B'
                    }}
                    width={75} />
                  
                  <Tooltip />
                  <Legend
                    wrapperStyle={{
                      fontSize: 11
                    }} />
                  
                  <Bar dataKey="actual" name="FY21 Total" fill="#0D9488" />
                  <Bar
                    dataKey="simulation"
                    name="FY21 Simulation"
                    fill="#99F6E4" />
                  
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper
            sx={{
              p: 2.5,
              height: '100%'
            }}>
            
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="flex-start">
              
              <Box>
                <Typography
                  variant="subtitle1"
                  sx={{
                    fontWeight: 700
                  }}>
                  
                  Pricing health summary
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#64748B'
                  }}>
                  
                  Overall Operating Margin vs target
                </Typography>
              </Box>
              <Chip
                icon={<TrendingUpIcon />}
                label="On track"
                size="small"
                sx={{
                  bgcolor: '#DCFCE7',
                  color: '#16A34A',
                  fontWeight: 700,
                  '& .MuiChip-icon': {
                    color: '#16A34A'
                  }
                }} />
              
            </Stack>
            <Stack
              spacing={2.5}
              sx={{
                mt: 2.5
              }}>
              
              <Box>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  sx={{
                    mb: 0.5
                  }}>
                  
                  <Typography
                    variant="caption"
                    sx={{
                      color: '#64748B'
                    }}>
                    
                    Products in target range
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 700
                    }}>
                    
                    18 / 25
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={72}
                  sx={{
                    height: 8,
                    borderRadius: 4,
                    bgcolor: '#F1F5F9',
                    '& .MuiLinearProgress-bar': {
                      bgcolor: '#16A34A'
                    }
                  }} />
                
              </Box>
              <Box>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  sx={{
                    mb: 0.5
                  }}>
                  
                  <Typography
                    variant="caption"
                    sx={{
                      color: '#64748B'
                    }}>
                    
                    Markup adjustments proposed
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 700
                    }}>
                    
                    12
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={48}
                  sx={{
                    height: 8,
                    borderRadius: 4,
                    bgcolor: '#F1F5F9',
                    '& .MuiLinearProgress-bar': {
                      bgcolor: '#2563EB'
                    }
                  }} />
                
              </Box>
              <Box>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  sx={{
                    mb: 0.5
                  }}>
                  
                  <Typography
                    variant="caption"
                    sx={{
                      color: '#64748B'
                    }}>
                    
                    Products breaching range
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 700
                    }}>
                    
                    3
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={12}
                  sx={{
                    height: 8,
                    borderRadius: 4,
                    bgcolor: '#F1F5F9',
                    '& .MuiLinearProgress-bar': {
                      bgcolor: '#DC2626'
                    }
                  }} />
                
              </Box>
            </Stack>
            <Box
              sx={{
                mt: 2.5,
                p: 1.5,
                bgcolor: '#F8FAFC',
                borderRadius: 1.5,
                border: '1px solid #E2E8F0'
              }}>
              
              <Typography
                variant="caption"
                sx={{
                  color: '#64748B',
                  fontWeight: 600
                }}>
                
                Average markup shift
              </Typography>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <TrendingUpIcon
                  sx={{
                    fontSize: 18,
                    color: '#16A34A'
                  }} />
                
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 800
                  }}>
                  
                  +4.2 pts
                </Typography>
              </Stack>
            </Box>
          </Paper>
        </Grid>
      </Grid>

      {/* Bottom: Current vs New markup table */}
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
          
          <Box>
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 700
              }}>
              
              Current price vs New price comparison
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: '#64748B'
              }}>
              
              Markup % by country and product · FY21 Total
            </Typography>
          </Box>
          <Stack direction="row" spacing={2}>
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  bgcolor: '#C4B5FD',
                  borderRadius: 0.5
                }} />
              
              <Typography
                variant="caption"
                sx={{
                  color: '#475569'
                }}>
                
                Current Markup
              </Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  bgcolor: '#2563EB',
                  borderRadius: 0.5
                }} />
              
              <Typography
                variant="caption"
                sx={{
                  color: '#475569'
                }}>
                
                New Markup
              </Typography>
            </Stack>
          </Stack>
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
              <TableRow
                sx={{
                  bgcolor: '#F8FAFC'
                }}>
                
                <TableCell
                  sx={{
                    fontWeight: 700,
                    width: 140
                  }}>
                  
                  Country
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: 700,
                    width: 120
                  }}>
                  
                  Product
                </TableCell>
                <TableCell
                  align="right"
                  sx={{
                    fontWeight: 700,
                    width: 110
                  }}>
                  
                  Current %
                </TableCell>
                <TableCell
                  align="right"
                  sx={{
                    fontWeight: 700,
                    width: 110
                  }}>
                  
                  New %
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: 700
                  }}>
                  
                  Comparison
                </TableCell>
                <TableCell
                  align="right"
                  sx={{
                    fontWeight: 700,
                    width: 90
                  }}>
                  
                  Δ
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {markupData.flatMap((c) =>
              c.products.map((p, i) => {
                const delta = +(p.proposed - p.current).toFixed(1);
                const maxVal = Math.max(
                  ...markupData.flatMap((cc) =>
                  cc.products.flatMap((pp) => [
                  Math.abs(pp.current),
                  Math.abs(pp.proposed)]
                  )
                  )
                );
                const currentW = Math.abs(p.current) / maxVal * 100;
                const proposedW = Math.abs(p.proposed) / maxVal * 100;
                return (
                  <TableRow key={`${c.country}-${p.name}`} hover>
                      <TableCell
                      sx={{
                        fontWeight: 700,
                        color: '#0F172A'
                      }}>
                      
                        {i === 0 ? c.country : ''}
                      </TableCell>
                      <TableCell
                      sx={{
                        color: '#475569'
                      }}>
                      
                        {p.name}
                      </TableCell>
                      <TableCell align="right">
                        {p.current.toFixed(1)}%
                      </TableCell>
                      <TableCell
                      align="right"
                      sx={{
                        fontWeight: 700
                      }}>
                      
                        {p.proposed.toFixed(1)}%
                      </TableCell>
                      <TableCell>
                        <Stack spacing={0.5}>
                          <Box
                          sx={{
                            width: `${currentW}%`,
                            height: 8,
                            bgcolor: '#C4B5FD',
                            borderRadius: 0.5,
                            minWidth: 4
                          }} />
                        
                          <Box
                          sx={{
                            width: `${proposedW}%`,
                            height: 8,
                            bgcolor: '#2563EB',
                            borderRadius: 0.5,
                            minWidth: 4
                          }} />
                        
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <Stack
                        direction="row"
                        spacing={0.25}
                        alignItems="center"
                        justifyContent="flex-end">
                        
                          {delta >= 0 ?
                        <TrendingUpIcon
                          sx={{
                            fontSize: 14,
                            color: '#16A34A'
                          }} /> :


                        <TrendingDownIcon
                          sx={{
                            fontSize: 14,
                            color: '#DC2626'
                          }} />

                        }
                          <Typography
                          variant="caption"
                          sx={{
                            fontWeight: 700,
                            color: delta >= 0 ? '#16A34A' : '#DC2626'
                          }}>
                          
                            {delta >= 0 ? '+' : ''}
                            {delta}
                          </Typography>
                        </Stack>
                      </TableCell>
                    </TableRow>);

              })
              )}
            </TableBody>
          </Table>
        </Box>
      </Paper>
    </Box>);

}