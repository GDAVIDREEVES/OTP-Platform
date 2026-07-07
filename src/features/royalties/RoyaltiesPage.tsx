import React from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '@/shared/components/layout/AppShell';
import RunsAsProcessBanner from '@/shared/components/RunsAsProcessBanner';
import {
  Paper,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Box,
  Stack,
  Button,
  Grid,
  LinearProgress } from
'@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useRoyalties } from '@/shared/providers/DataProvider';
import { formatCurrency } from '@/shared/utils/format';
export default function Royalties() {
  const navigate = useNavigate();
  const royalties = useRoyalties();
  const totalFees = royalties.reduce((a, r) => a + r.ytdFees, 0);
  const flagged = royalties.filter((r) => !r.withinBenchmark).length;
  return (
    <AppShell pageTitle="Royalties & Concept Fees">
      <RunsAsProcessBanner
        note="Royalty work runs as guided processes — this is a read-only reference view."
        processes={[
        { id: 'OTP-3', label: 'OTP-3 · set rates' },
        { id: 'OTP-9', label: 'OTP-9 · charge batch' }]} />

      <Grid
        container
        spacing={2.5}
        sx={{
          mb: 2.5
        }}>
        
        <Grid item xs={12} sm={4}>
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
              
              YTD Royalty Fees
            </Typography>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 800
              }}>
              
              {formatCurrency(totalFees, 'USD', true)}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
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
              
              Active IP Arrangements
            </Typography>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 800
              }}>
              
              {royalties.length}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
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
              
              Flagged vs. Benchmark
            </Typography>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 800,
                color: flagged ? '#DC2626' : '#16A34A'
              }}>
              
              {flagged}
            </Typography>
          </Paper>
        </Grid>
      </Grid>

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
              
              IP Royalty & Concept Fee Arrangements
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: '#64748B'
              }}>
              
              Rates validated against firm benchmarks and jurisdictional
              withholding rules.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button variant="outlined" onClick={() => navigate('/process/OTP-3/overview')}>
              Set rates (OTP-3)
            </Button>
            <Button variant="outlined" onClick={() => navigate('/process/OTP-9/overview')}>
              Run charge batch (OTP-9)
            </Button>
          </Stack>
        </Stack>

        <Box
          sx={{
            overflowX: 'auto'
          }}>
          
          <Table
            size="small"
            sx={{
              minWidth: 960
            }}>
            
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>IP Category</TableCell>
                <TableCell>Licensor</TableCell>
                <TableCell>Licensee</TableCell>
                <TableCell align="right">Rate</TableCell>
                <TableCell>Base</TableCell>
                <TableCell>Benchmark (IQR)</TableCell>
                <TableCell align="right">YTD Fees</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Jurisdiction Note</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {royalties.map((r) =>
              <TableRow key={r.id} hover>
                  <TableCell
                  sx={{
                    fontWeight: 700
                  }}>
                  
                    {r.id}
                  </TableCell>
                  <TableCell>{r.ipCategory}</TableCell>
                  <TableCell>{r.licensor}</TableCell>
                  <TableCell>{r.licensee}</TableCell>
                  <TableCell
                  align="right"
                  sx={{
                    fontWeight: 700
                  }}>
                  
                    {r.rate}%
                  </TableCell>
                  <TableCell>{r.base}</TableCell>
                  <TableCell>
                    <Box>
                      <Typography
                      variant="caption"
                      sx={{
                        color: '#475569'
                      }}>
                      
                        {r.benchmarkRange}
                      </Typography>
                      <LinearProgress
                      variant="determinate"
                      value={r.withinBenchmark ? 60 : 95}
                      sx={{
                        mt: 0.5,
                        height: 4,
                        borderRadius: 2,
                        bgcolor: '#F1F5F9',
                        '& .MuiLinearProgress-bar': {
                          bgcolor: r.withinBenchmark ? '#16A34A' : '#DC2626'
                        }
                      }} />
                    
                    </Box>
                  </TableCell>
                  <TableCell align="right">
                    {formatCurrency(r.ytdFees, 'USD', true)}
                  </TableCell>
                  <TableCell>
                    {r.withinBenchmark ?
                  <Chip
                    size="small"
                    icon={<CheckCircleIcon />}
                    label="Within benchmark"
                    sx={{
                      bgcolor: '#DCFCE7',
                      color: '#15803D',
                      fontWeight: 700,
                      '& .MuiChip-icon': {
                        color: '#15803D'
                      }
                    }} /> :


                  <Chip
                    size="small"
                    icon={<WarningAmberIcon />}
                    label="Review"
                    sx={{
                      bgcolor: '#FEE2E2',
                      color: '#B91C1C',
                      fontWeight: 700,
                      '& .MuiChip-icon': {
                        color: '#B91C1C'
                      }
                    }} />

                  }
                  </TableCell>
                  <TableCell
                  sx={{
                    color: '#64748B',
                    maxWidth: 240
                  }}>
                  
                    <Typography variant="caption">
                      {r.jurisdictionNote}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </Paper>
    </AppShell>);

}