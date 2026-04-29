import React, { useState } from 'react';
import AppShell from '../components/layout/AppShell';
import {
  Paper,
  Typography,
  Box,
  Grid,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Stack,
  Button,
  Tabs,
  Tab } from
'@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { statusColor } from '../components/data/entities';
import { useEntities } from '../data/DataProvider';
import { formatCurrency } from '../components/theme';
import ProductPricing from '../components/pricing/ProductPricing';
export default function PriceSetting() {
  const [tab, setTab] = useState(0);
  const entities = useEntities();
  const tested = entities.filter((e) => e.actualMargin !== null);
  const passed = tested.filter((e) => e.status === 'in-range').length;
  const failed = tested.filter((e) => e.status === 'out-of-range').length;
  return (
    <AppShell pageTitle="Price Setting & Arm's Length Testing">
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{
          mb: 2
        }}>
        
        <Box>
          <Typography
            variant="h5"
            sx={{
              fontWeight: 700
            }}>
            
            {tab === 0 ? 'Automated ALS testing' : 'Product-level pricing'}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: '#64748B'
            }}>
            
            {tab === 0 ?
            'Every intercompany transaction tested against policy. Last run: Dec 10, 2025 — 09:10 AM.' :
            'Berry ratio analysis and markup simulation across entities and products.'}
          </Typography>
        </Box>
        {tab === 0 &&
        <Button variant="contained" startIcon={<PlayArrowIcon />}>
            Run testing now
          </Button>
        }
      </Stack>

      <Paper
        sx={{
          mb: 2.5,
          px: 1
        }}>
        
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{
            minHeight: 44
          }}>
          
          <Tab
            label="ALS Testing"
            sx={{
              fontWeight: 600,
              minHeight: 44
            }} />
          
          <Tab
            label="Product-level pricing"
            sx={{
              fontWeight: 600,
              minHeight: 44
            }} />
          
        </Tabs>
      </Paper>

      {tab === 0 &&
      <>
          <Grid
          container
          spacing={2}
          sx={{
            mb: 2.5
          }}>
          
            <Grid item xs={6} md={3}>
              <Paper
              sx={{
                p: 2.5
              }}>
              
                <Typography
                variant="caption"
                sx={{
                  color: '#64748B',
                  fontWeight: 600,
                  textTransform: 'uppercase'
                }}>
                
                  Tested
                </Typography>
                <Typography
                variant="h5"
                sx={{
                  fontWeight: 800
                }}>
                
                  {tested.length}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={6} md={3}>
              <Paper
              sx={{
                p: 2.5
              }}>
              
                <Typography
                variant="caption"
                sx={{
                  color: '#64748B',
                  fontWeight: 600,
                  textTransform: 'uppercase'
                }}>
                
                  Passed
                </Typography>
                <Typography
                variant="h5"
                sx={{
                  fontWeight: 800,
                  color: '#16A34A'
                }}>
                
                  {passed}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={6} md={3}>
              <Paper
              sx={{
                p: 2.5
              }}>
              
                <Typography
                variant="caption"
                sx={{
                  color: '#64748B',
                  fontWeight: 600,
                  textTransform: 'uppercase'
                }}>
                
                  Failed
                </Typography>
                <Typography
                variant="h5"
                sx={{
                  fontWeight: 800,
                  color: '#DC2626'
                }}>
                
                  {failed}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={6} md={3}>
              <Paper
              sx={{
                p: 2.5
              }}>
              
                <Typography
                variant="caption"
                sx={{
                  color: '#64748B',
                  fontWeight: 600,
                  textTransform: 'uppercase'
                }}>
                
                  Pass rate
                </Typography>
                <Typography
                variant="h5"
                sx={{
                  fontWeight: 800
                }}>
                
                  {Math.round(passed / tested.length * 100)}%
                </Typography>
              </Paper>
            </Grid>
          </Grid>

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
            
              Testing results
            </Typography>
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
                    <TableCell>Entity</TableCell>
                    <TableCell>Tested party</TableCell>
                    <TableCell>Method</TableCell>
                    <TableCell align="right">Actual PLI</TableCell>
                    <TableCell align="right">Range</TableCell>
                    <TableCell align="right">Volume tested</TableCell>
                    <TableCell>Result</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tested.map((e) =>
                <TableRow key={e.id} hover>
                      <TableCell
                    sx={{
                      fontWeight: 700
                    }}>
                    
                        {e.id}
                      </TableCell>
                      <TableCell>{e.name}</TableCell>
                      <TableCell>{e.tpMethod}</TableCell>
                      <TableCell align="right">{e.actualMargin}%</TableCell>
                      <TableCell align="right">{e.targetMarginLabel}</TableCell>
                      <TableCell align="right">
                        {formatCurrency(e.ytdVolume, 'USD', true)}
                      </TableCell>
                      <TableCell>
                        <Chip
                      icon={
                      e.status === 'out-of-range' ?
                      <ErrorIcon /> :

                      <CheckCircleIcon />

                      }
                      label={
                      e.status === 'out-of-range' ?
                      'Fail' :
                      e.status === 'watch' ?
                      'Watch' :
                      'Pass'
                      }
                      size="small"
                      sx={{
                        bgcolor: `${statusColor[e.status]}18`,
                        color: statusColor[e.status],
                        fontWeight: 700,
                        '& .MuiChip-icon': {
                          color: statusColor[e.status]
                        }
                      }} />
                    
                      </TableCell>
                    </TableRow>
                )}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        </>
      }

      {tab === 1 && <ProductPricing />}
    </AppShell>);

}