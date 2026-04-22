import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import {
  Grid,
  Paper,
  Box,
  Typography,
  Stack,
  Chip,
  Button,
  IconButton,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Divider,
  Link as MuiLink,
  Avatar } from
'@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CloseIcon from '@mui/icons-material/Close';
import PsychologyIcon from '@mui/icons-material/Psychology';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer } from
'recharts';
import WorldMap from '../components/dashboard/WorldMap';
import {
  entities,
  statusColor,
  statusLabel,
  totalICVolume,
  entitiesInRange,
  entitiesOutOfRange } from
'../components/data/entities';
import { monthlyMarginTrend } from '../components/data/transactions';
import { formatCurrency } from '../components/theme';
import { useResearchBrain } from '../components/research-brain/ResearchBrainContext';
interface KpiCardProps {
  label: string;
  value: string;
  subtitle: string;
  accent: 'primary' | 'success' | 'error' | 'warning';
  icon: React.ReactNode;
  trend?: string;
  onClick?: () => void;
}
const accentMap = {
  primary: {
    color: '#0F172A',
    bg: '#EFF6FF',
    iconColor: '#2563EB'
  },
  success: {
    color: '#16A34A',
    bg: '#DCFCE7',
    iconColor: '#16A34A'
  },
  error: {
    color: '#DC2626',
    bg: '#FEE2E2',
    iconColor: '#DC2626'
  },
  warning: {
    color: '#D97706',
    bg: '#FEF3C7',
    iconColor: '#D97706'
  }
};
function KpiCard({
  label,
  value,
  subtitle,
  accent,
  icon,
  trend,
  onClick
}: KpiCardProps) {
  const a = accentMap[accent];
  return (
    <Paper
      onClick={onClick}
      sx={{
        p: 2.5,
        height: '100%',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.15s',
        '&:hover': onClick ?
        {
          borderColor: '#2563EB',
          boxShadow: '0 4px 12px rgba(15,23,42,0.08)'
        } :
        {}
      }}>
      
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        sx={{
          mb: 1.5
        }}>
        
        <Typography
          variant="caption"
          sx={{
            color: '#64748B',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em'
          }}>
          
          {label}
        </Typography>
        <Avatar
          sx={{
            bgcolor: a.bg,
            color: a.iconColor,
            width: 36,
            height: 36
          }}>
          
          {icon}
        </Avatar>
      </Stack>
      <Typography
        variant="h4"
        sx={{
          fontWeight: 800,
          color: a.color,
          lineHeight: 1.1,
          mb: 0.5
        }}>
        
        {value}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: '#475569',
          fontSize: 13
        }}>
        
        {subtitle}
      </Typography>
      {trend &&
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.5}
        sx={{
          mt: 1
        }}>
        
          <TrendingUpIcon
          sx={{
            fontSize: 14,
            color: '#16A34A'
          }} />
        
          <Typography
          variant="caption"
          sx={{
            color: '#16A34A',
            fontWeight: 700
          }}>
          
            {trend}
          </Typography>
        </Stack>
      }
    </Paper>);

}
const tableEntityIds = [
'IE-002',
'MX-002',
'CA-001',
'UK-001',
'US-003',
'CH-001'];

interface Alert {
  id: string;
  entityId: string;
  severity: 'HIGH' | 'MEDIUM';
  title: string;
  body: string;
  timestamp: string;
  primaryAction: string;
}
const alerts: Alert[] = [
{
  id: 'a1',
  entityId: 'IE-002',
  severity: 'HIGH',
  title: 'IE-002 Operating Margin Overshoot',
  body: 'Ireland Distribution Co. operating margin is 29%, exceeding the 4% TNMM target by +25pp. TP adjustment of $286,764,240 required. Year-end true-up recommended.',
  timestamp: 'Dec 10, 2025 — 09:14 AM',
  primaryAction: 'Run Adjustment'
},
{
  id: 'a2',
  entityId: 'MX-002',
  severity: 'MEDIUM',
  title: 'MX-002 Approaching Lower Threshold',
  body: "Mexico Distribution Co. operating margin at 17%, approaching arm's length floor. Monitor Q4 freight costs. No action required yet.",
  timestamp: 'Dec 9, 2025 — 03:47 PM',
  primaryAction: 'Review'
},
{
  id: 'a3',
  entityId: 'CA-001',
  severity: 'MEDIUM',
  title: 'CA-001 Approaching Lower Threshold',
  body: 'Canada Distribution Co. operating margin at 18%, within range but trending toward lower bound. Q4 volume uptick may resolve.',
  timestamp: 'Dec 8, 2025 — 11:22 AM',
  primaryAction: 'Review'
}];

export default function Dashboard() {
  const navigate = useNavigate();
  const { openPanel } = useResearchBrain();
  const [filterOutOfRange, setFilterOutOfRange] = useState(false);
  const tableEntities = useMemo(() => {
    const base = entities.
    filter((e) => tableEntityIds.includes(e.id)).
    sort(
      (a, b) => tableEntityIds.indexOf(a.id) - tableEntityIds.indexOf(b.id)
    );
    return filterOutOfRange ?
    base.filter((e) => e.status === 'out-of-range') :
    base;
  }, [filterOutOfRange]);
  const askBrainForAlert = (a: Alert) => {
    const entity = entities.find((e) => e.id === a.entityId);
    openPanel({
      entityId: a.entityId,
      entityName: entity?.name,
      jurisdiction: entity?.country,
      function: entity?.function,
      transactionType: 'Tangible Goods',
      method: entity?.tpMethod
    });
  };
  return (
    <AppShell pageTitle="Global TP Monitoring Dashboard">
      <Grid container spacing={2.5}>
        {/* Main column */}
        <Grid item xs={12} lg={8}>
          {/* KPI Strip */}
          <Grid
            container
            spacing={2}
            sx={{
              mb: 2.5
            }}>
            
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard
                label="Total IC Volume (YTD)"
                value={formatCurrency(totalICVolume, 'USD', true)}
                subtitle="Across 20 entities, 10 transaction types"
                accent="primary"
                icon={<TrendingUpIcon />}
                trend="+8.3% vs. prior year" />
              
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard
                label="Entities In Range"
                value={`${entitiesInRange} of 20`}
                subtitle="Operating within arm's length policy"
                accent="success"
                icon={<CheckCircleIcon />} />
              
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard
                label="Entities Out of Range"
                value={String(entitiesOutOfRange)}
                subtitle="Require attention or adjustment"
                accent="error"
                icon={<ErrorIcon />}
                onClick={() => setFilterOutOfRange((v) => !v)} />
              
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard
                label="Pending Actions"
                value="7"
                subtitle="3 invoices awaiting approval · 4 adjustments pending review"
                accent="warning"
                icon={<AccessTimeIcon />}
                onClick={() => navigate('/invoicing')} />
              
            </Grid>
          </Grid>

          {/* World map */}
          <Box
            sx={{
              mb: 2.5
            }}>
            
            <WorldMap onEntityClick={(e) => navigate(`/entities/${e.id}`)} />
          </Box>

          {/* Entity Summary Table */}
          <Paper
            sx={{
              p: 2.5,
              mb: 2.5
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
                  
                  Entity Summary
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#64748B'
                  }}>
                  
                  {filterOutOfRange ?
                  'Showing entities out of range only' :
                  'Top flagged and representative entities'}
                </Typography>
              </Box>
              {filterOutOfRange &&
              <Button
                size="small"
                variant="outlined"
                onClick={() => setFilterOutOfRange(false)}>
                
                  Clear filter
                </Button>
              }
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
                    <TableCell>Entity ID</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Country</TableCell>
                    <TableCell>Function</TableCell>
                    <TableCell>TP Method</TableCell>
                    <TableCell align="right">YTD Volume</TableCell>
                    <TableCell align="right">Actual</TableCell>
                    <TableCell align="right">Target</TableCell>
                    <TableCell align="right">Variance</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Last Updated</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tableEntities.map((e) =>
                  <TableRow key={e.id} hover>
                      <TableCell
                      sx={{
                        fontWeight: 700
                      }}>
                      
                        {e.id}
                      </TableCell>
                      <TableCell>{e.name}</TableCell>
                      <TableCell>{e.countryCode}</TableCell>
                      <TableCell>{e.function}</TableCell>
                      <TableCell>{e.tpMethod}</TableCell>
                      <TableCell
                      align="right"
                      sx={{
                        fontVariantNumeric: 'tabular-nums'
                      }}>
                      
                        {formatCurrency(e.ytdVolume, 'USD', true)}
                      </TableCell>
                      <TableCell
                      align="right"
                      sx={{
                        fontVariantNumeric: 'tabular-nums'
                      }}>
                      
                        {e.actualMargin !== null ? `${e.actualMargin}%` : '—'}
                      </TableCell>
                      <TableCell
                      align="right"
                      sx={{
                        fontVariantNumeric: 'tabular-nums'
                      }}>
                      
                        {e.targetMarginLabel}
                      </TableCell>
                      <TableCell
                      align="right"
                      sx={{
                        fontVariantNumeric: 'tabular-nums',
                        color:
                        e.variance && e.variance > 0 ?
                        '#DC2626' :
                        '#475569',
                        fontWeight: e.variance && e.variance > 0 ? 700 : 400
                      }}>
                      
                        {e.variance && e.variance > 0 ?
                      `+${e.variance}pp` :
                      '—'}
                      </TableCell>
                      <TableCell>
                        <Chip
                        label={statusLabel[e.status]}
                        size="small"
                        sx={{
                          bgcolor: `${statusColor[e.status]}18`,
                          color: statusColor[e.status],
                          fontWeight: 700
                        }} />
                      
                      </TableCell>
                      <TableCell
                      sx={{
                        color: '#64748B'
                      }}>
                      
                        {e.lastUpdated}
                      </TableCell>
                      <TableCell align="right">
                        <Stack
                        direction="row"
                        spacing={0.5}
                        justifyContent="flex-end">
                        
                          <Button
                          size="small"
                          variant="outlined"
                          onClick={() => navigate(`/entities/${e.id}`)}>
                          
                            Review
                          </Button>
                          {e.status === 'out-of-range' &&
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => navigate(`/adjustment/${e.id}`)}>
                          
                              Adjust
                            </Button>
                        }
                        </Stack>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
            <Divider
              sx={{
                my: 1.5
              }} />
            
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center">
              
              <Typography
                variant="caption"
                sx={{
                  color: '#64748B'
                }}>
                
                Showing {tableEntities.length} of 20 entities
              </Typography>
              <MuiLink
                component="button"
                underline="hover"
                sx={{
                  fontSize: 13,
                  fontWeight: 600
                }}
                onClick={() => setFilterOutOfRange(false)}>
                
                View All{' '}
                <ArrowForwardIcon
                  sx={{
                    fontSize: 14,
                    verticalAlign: 'middle'
                  }} />
                
              </MuiLink>
            </Stack>
          </Paper>

          {/* Trend chart */}
          <Paper
            sx={{
              p: 2.5
            }}>
            
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="flex-start"
              sx={{
                mb: 2
              }}>
              
              <Box>
                <Typography
                  variant="subtitle1"
                  sx={{
                    fontWeight: 700
                  }}>
                  
                  Entity Operating Margin Trends
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#64748B'
                  }}>
                  
                  FY2025 — Jan through Dec
                </Typography>
              </Box>
            </Stack>
            <Box
              sx={{
                width: '100%',
                height: 320
              }}>
              
              <ResponsiveContainer>
                <LineChart
                  data={monthlyMarginTrend}
                  margin={{
                    top: 10,
                    right: 24,
                    left: 0,
                    bottom: 8
                  }}>
                  
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="month" stroke="#64748B" fontSize={12} />
                  <YAxis
                    stroke="#64748B"
                    fontSize={12}
                    domain={[0, 35]}
                    tickFormatter={(v) => `${v}%`} />
                  
                  <ReTooltip formatter={(v: any) => `${v}%`} />
                  <Legend
                    wrapperStyle={{
                      fontSize: 12
                    }} />
                  
                  <ReferenceLine
                    y={4}
                    stroke="#16A34A"
                    strokeDasharray="4 4"
                    label={{
                      value: 'Target Floor (4%)',
                      position: 'insideLeft',
                      fontSize: 11,
                      fill: '#16A34A'
                    }} />
                  
                  <ReferenceLine
                    y={7}
                    stroke="#2563EB"
                    strokeDasharray="4 4"
                    label={{
                      value: 'Target Ceiling (7%)',
                      position: 'insideLeft',
                      fontSize: 11,
                      fill: '#2563EB'
                    }} />
                  
                  <Line
                    type="monotone"
                    dataKey="IE-002"
                    stroke="#DC2626"
                    strokeWidth={2.5}
                    dot={{
                      r: 3
                    }} />
                  
                  <Line
                    type="monotone"
                    dataKey="UK-001"
                    stroke="#F97316"
                    strokeWidth={2.5}
                    dot={{
                      r: 3
                    }} />
                  
                  <Line
                    type="monotone"
                    dataKey="MX-002"
                    stroke="#D97706"
                    strokeWidth={2.5}
                    dot={{
                      r: 3
                    }} />
                  
                  <Line
                    type="monotone"
                    dataKey="US-003"
                    stroke="#16A34A"
                    strokeWidth={2.5}
                    dot={{
                      r: 3
                    }} />
                  
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </Paper>
        </Grid>

        {/* Right rail: Alerts */}
        <Grid item xs={12} lg={4}>
          <Paper
            sx={{
              p: 2.5,
              position: {
                lg: 'sticky'
              },
              top: 84
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
                  
                  Active Alerts ({alerts.length})
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#64748B'
                  }}>
                  
                  Real-time deviation feed
                </Typography>
              </Box>
              <MuiLink
                component="button"
                underline="hover"
                sx={{
                  fontSize: 12,
                  fontWeight: 600
                }}>
                
                Mark all read
              </MuiLink>
            </Stack>
            <Stack spacing={1.5}>
              {alerts.map((a) => {
                const isHigh = a.severity === 'HIGH';
                const accent = isHigh ? '#DC2626' : '#D97706';
                const accentBg = isHigh ? '#FEE2E2' : '#FEF3C7';
                return (
                  <Paper
                    key={a.id}
                    variant="outlined"
                    sx={{
                      p: 1.75,
                      borderLeft: `4px solid ${accent}`
                    }}>
                    
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="flex-start"
                      sx={{
                        mb: 0.75
                      }}>
                      
                      <Stack direction="row" spacing={1} alignItems="center">
                        {isHigh ?
                        <ErrorIcon
                          sx={{
                            color: accent,
                            fontSize: 18
                          }} /> :


                        <WarningIcon
                          sx={{
                            color: accent,
                            fontSize: 18
                          }} />

                        }
                        <Chip
                          label={a.severity}
                          size="small"
                          sx={{
                            height: 18,
                            fontSize: 10,
                            bgcolor: accentBg,
                            color: accent,
                            fontWeight: 800
                          }} />
                        
                      </Stack>
                      <IconButton size="small" aria-label="Dismiss">
                        <CloseIcon
                          sx={{
                            fontSize: 16
                          }} />
                        
                      </IconButton>
                    </Stack>
                    <Typography
                      variant="subtitle2"
                      sx={{
                        fontWeight: 700,
                        mb: 0.5,
                        lineHeight: 1.3
                      }}>
                      
                      {a.title}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        color: '#475569',
                        fontSize: 13,
                        lineHeight: 1.5,
                        mb: 1
                      }}>
                      
                      {a.body}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        color: '#94A3B8',
                        display: 'block',
                        mb: 1.25
                      }}>
                      
                      {a.timestamp}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="contained"
                        color={isHigh ? 'error' : 'warning'}
                        onClick={() => navigate(`/adjustment/${a.entityId}`)}
                        sx={{
                          color: 'white'
                        }}>
                        
                        {a.primaryAction}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<PsychologyIcon />}
                        onClick={() => askBrainForAlert(a)}>
                        
                        Ask Research Brain
                      </Button>
                    </Stack>
                  </Paper>);

              })}
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </AppShell>);

}