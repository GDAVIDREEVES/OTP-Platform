import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adjustmentRoute } from '@/kernel/workflow/originRoute';
import AppShell from '@/shared/components/layout/AppShell';
import {
  Paper,
  Typography,
  Grid,
  Box,
  Stack,
  Chip,
  Button,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Divider,
  Alert } from
'@mui/material';
import PsychologyIcon from '@mui/icons-material/Psychology';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { statusColor, statusLabel } from '@/shared/utils/status';
import { useEntity, useMarginTrend } from '@/shared/providers/DataProvider';
import { useEntityFlows } from '@/shared/hooks/useEntityFlows';
import { formatCurrency } from '@/shared/utils/format';
import { useResearchBrain } from '@/features/research-brain/ResearchBrainContext';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  ReferenceLine } from
'recharts';
export default function EntityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const e = useEntity(id);
  const monthlyMarginTrend = useMarginTrend();
  const flows = useEntityFlows(id);
  const { openPanel } = useResearchBrain();
  if (!e)
  return (
    <AppShell pageTitle="Entity not found">
        <Paper
        sx={{
          p: 3
        }}>
        
          Entity {id} not found.
        </Paper>
      </AppShell>);

  const suggestedAdjustment =
  e.variance && e.actualMargin ?
  Math.round(
    e.ytdVolume * (
    (e.actualMargin - (e.targetMarginLow + e.targetMarginHigh) / 2) /
    100)
  ) :
  0;
  // mock line-level transactions
  const txns = [
  {
    id: 'TX-88301',
    date: 'Nov 2025',
    desc: 'Finished goods purchase from IE-001',
    amount: 98200000,
    margin: 29
  },
  {
    id: 'TX-87112',
    date: 'Oct 2025',
    desc: 'Finished goods purchase from IE-001',
    amount: 103400000,
    margin: 28
  },
  {
    id: 'TX-85904',
    date: 'Sep 2025',
    desc: 'Finished goods purchase from IE-001',
    amount: 101800000,
    margin: 27
  },
  {
    id: 'TX-84501',
    date: 'Aug 2025',
    desc: 'Freight & logistics',
    amount: 4200000,
    margin: null
  },
  {
    id: 'TX-83422',
    date: 'Jul 2025',
    desc: 'Marketing concept fee to UK-002',
    amount: 1800000,
    margin: null
  }];

  return (
    <AppShell
      pageTitle={`${e.id} — ${e.name}`}
      breadcrumbs={[{ label: 'Monitoring', to: '/dashboard' }, { label: e.name }]}
    >
      <Grid container spacing={2.5}>
        <Grid item xs={12} md={8}>
          <Paper
            sx={{
              p: 3,
              mb: 2.5
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
                  variant="h4"
                  sx={{
                    fontWeight: 800
                  }}>
                  
                  {e.name}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    color: '#64748B'
                  }}>
                  
                  {e.id} · {e.country} · {e.function}
                </Typography>
              </Box>
              <Chip
                label={statusLabel[e.status]}
                sx={{
                  bgcolor: `${statusColor[e.status]}18`,
                  color: statusColor[e.status],
                  fontWeight: 700
                }} />
              
            </Stack>

            <Grid container spacing={2}>
              <Grid item xs={6} sm={3}>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#64748B',
                    fontWeight: 600,
                    textTransform: 'uppercase'
                  }}>
                  
                  YTD Volume
                </Typography>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 700
                  }}>
                  
                  {formatCurrency(e.ytdVolume, 'USD', true)}
                </Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#64748B',
                    fontWeight: 600,
                    textTransform: 'uppercase'
                  }}>
                  
                  Actual OM
                </Typography>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 700,
                    color: statusColor[e.status]
                  }}>
                  
                  {e.actualMargin !== null ? `${e.actualMargin}%` : '—'}
                </Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#64748B',
                    fontWeight: 600,
                    textTransform: 'uppercase'
                  }}>
                  
                  Target
                </Typography>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 700
                  }}>
                  
                  {e.targetMarginLabel}
                </Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#64748B',
                    fontWeight: 600,
                    textTransform: 'uppercase'
                  }}>
                  
                  TP Method
                </Typography>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 700
                  }}>
                  
                  {e.tpMethod}
                </Typography>
              </Grid>
            </Grid>

            {e.status === 'out-of-range' &&
            <Alert
              severity="error"
              sx={{
                mt: 3
              }}
              action={
              <Button
                color="inherit"
                size="small"
                variant="contained"
                onClick={() => navigate(adjustmentRoute(e.id))}
                startIcon={<PlayArrowIcon />}>
                
                    Run Adjustment
                  </Button>
              }>
              
                Variance of <b>+{e.variance}pp</b> detected. Suggested
                compensating adjustment:{' '}
                <b>{formatCurrency(Math.abs(suggestedAdjustment), 'USD')}</b>
              </Alert>
            }
          </Paper>

          <Paper
            sx={{
              p: 2.5,
              mb: 2.5
            }}>
            
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 700,
                mb: 2
              }}>
              
              Operating margin trend (FY2025)
            </Typography>
            <Box
              sx={{
                width: '100%',
                height: 240
              }}>
              
              <ResponsiveContainer>
                <LineChart data={monthlyMarginTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={(v) => `${v}%`} />
                  <ReTooltip />
                  <ReferenceLine
                    y={e.targetMarginLow}
                    stroke="#16A34A"
                    strokeDasharray="4 4" />
                  
                  <ReferenceLine
                    y={e.targetMarginHigh}
                    stroke="#2563EB"
                    strokeDasharray="4 4" />
                  
                  <Line
                    type="monotone"
                    dataKey={e.id}
                    stroke={statusColor[e.status]}
                    strokeWidth={3} />
                  
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </Paper>

          {/* Flows by material type — driven by /api/entities/{id}/flows */}
          <Paper
            sx={{
              p: 2.5,
              mb: 2.5
            }}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="flex-end"
              sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Flows by material type
                </Typography>
                <Typography variant="caption" sx={{ color: '#64748B' }}>
                  Aggregated from supply-chain steps where this entity is the seller or buyer
                </Typography>
              </Box>
            </Stack>
            {flows.loading ? (
              <Typography variant="body2" sx={{ color: '#64748B', py: 2 }}>
                Loading flow breakdown…
              </Typography>
            ) : flows.error ? (
              <Alert severity="warning" sx={{ mb: 1 }}>
                {flows.error.message}
              </Alert>
            ) : flows.data && flows.data.length > 0 ? (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Direction</TableCell>
                    <TableCell>Material type</TableCell>
                    <TableCell>Method</TableCell>
                    <TableCell>Counterparties</TableCell>
                    <TableCell align="right">Chains</TableCell>
                    <TableCell align="right">YTD Volume</TableCell>
                    <TableCell>Tags</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {flows.data.map((f, i) => (
                    <TableRow key={`${f.direction}-${f.materialType}-${f.tpMethod}-${i}`} hover>
                      <TableCell>
                        <Chip
                          label={f.direction === 'sell' ? 'Sells' : 'Buys'}
                          size="small"
                          sx={{
                            bgcolor: f.direction === 'sell' ? '#DCFCE7' : '#EFF6FF',
                            color: f.direction === 'sell' ? '#15803D' : '#1D4ED8',
                            fontWeight: 700,
                            minWidth: 56
                          }} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {f.materialLabel}
                        </Typography>
                        <Typography variant="caption" sx={{ color: '#64748B' }}>
                          {f.materialType}
                        </Typography>
                      </TableCell>
                      <TableCell>{f.tpMethod}</TableCell>
                      <TableCell sx={{ color: '#475569' }}>
                        {f.counterparties.join(', ')}
                      </TableCell>
                      <TableCell align="right">{f.chains}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>
                        {formatCurrency(f.ytdVolume, e.currency || 'USD', true)}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5}>
                          {f.apa && (
                            <Chip
                              label="APA"
                              size="small"
                              sx={{
                                bgcolor: '#EFF6FF',
                                color: '#1D4ED8',
                                fontWeight: 700,
                                border: '1px solid #BFDBFE'
                              }} />
                          )}
                          {f.challenged && (
                            <Chip
                              label="Challenged"
                              size="small"
                              sx={{
                                bgcolor: '#FEF2F2',
                                color: '#B91C1C',
                                fontWeight: 700,
                                border: '1px solid #FECACA'
                              }} />
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Typography variant="body2" sx={{ color: '#64748B', py: 2 }}>
                No supply-chain flows found for this entity.
              </Typography>
            )}
          </Paper>

          <Paper
            sx={{
              p: 2.5
            }}>

            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 700,
                mb: 2
              }}>

              Underlying transactions
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>Period</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell align="right">Amount (USD)</TableCell>
                  <TableCell align="right">Implied OM</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {txns.map((t) =>
                <TableRow key={t.id} hover>
                    <TableCell
                    sx={{
                      fontWeight: 700
                    }}>

                      {t.id}
                    </TableCell>
                    <TableCell>{t.date}</TableCell>
                    <TableCell>{t.desc}</TableCell>
                    <TableCell align="right">
                      {formatCurrency(t.amount, 'USD', true)}
                    </TableCell>
                    <TableCell align="right">
                      {t.margin !== null ? `${t.margin}%` : '—'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          <Paper
            sx={{
              p: 2.5,
              mb: 2.5
            }}>
            
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                mb: 1.5
              }}>
              
              Quick actions
            </Typography>
            <Stack spacing={1}>
              <Button
                variant="contained"
                startIcon={<PlayArrowIcon />}
                fullWidth
                onClick={() => navigate(adjustmentRoute(e.id))}
                disabled={e.status === 'in-range'}>
                
                Run adjustment
              </Button>
              <Button
                variant="outlined"
                startIcon={<PsychologyIcon />}
                fullWidth
                onClick={() =>
                openPanel({
                  entityId: e.id,
                  entityName: e.name,
                  jurisdiction: e.country,
                  function: e.function,
                  method: e.tpMethod,
                  transactionType: 'Tangible Goods'
                })
                }>
                
                Ask Research Brain
              </Button>
              <Button variant="outlined" fullWidth>
                Export audit package
              </Button>
            </Stack>
          </Paper>

          <Paper
            sx={{
              p: 2.5
            }}>
            
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                mb: 1.5
              }}>
              
              Role & reviewers
            </Typography>
            <Stack spacing={1.5}>
              <Box>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#64748B'
                  }}>
                  
                  TP Role
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 600
                  }}>
                  
                  {e.tpRole}
                </Typography>
              </Box>
              <Divider />
              <Box>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#64748B'
                  }}>
                  
                  Primary reviewer
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 600
                  }}>
                  
                  Maria Chen — Group TP Manager
                </Typography>
              </Box>
              <Box>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#64748B'
                  }}>
                  
                  Approver
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 600
                  }}>
                  
                  Sam Rodriguez — Tax Director
                </Typography>
              </Box>
              <Box>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#64748B'
                  }}>
                  
                  Last synced from ERP
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 600
                  }}>
                  
                  {e.lastUpdated} · 09:12 AM
                </Typography>
              </Box>
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </AppShell>);

}