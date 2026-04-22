import React, { useState } from 'react';
import AppShell from '../components/layout/AppShell';
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
  Checkbox,
  Tabs,
  Tab } from
'@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import CheckIcon from '@mui/icons-material/Check';
import { invoices } from '../components/data/transactions';
const statusStyle: Record<
  string,
  {
    bg: string;
    color: string;
  }> =
{
  Draft: {
    bg: '#F1F5F9',
    color: '#475569'
  },
  'Pending Approval': {
    bg: '#FEF3C7',
    color: '#B45309'
  },
  Approved: {
    bg: '#DCFCE7',
    color: '#15803D'
  },
  Exported: {
    bg: '#EFF6FF',
    color: '#1D4ED8'
  }
};
export default function Invoicing() {
  const [tab, setTab] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const filtered = invoices.filter((i) => {
    if (tab === 0) return true;
    if (tab === 1) return i.status === 'Pending Approval';
    if (tab === 2) return i.status === 'Approved';
    return i.status === 'Exported';
  });
  const toggle = (id: string) =>
  setSelected((s) =>
  s.includes(id) ? s.filter((i) => i !== id) : [...s, id]
  );
  return (
    <AppShell pageTitle="Intercompany Invoicing">
      <Grid
        container
        spacing={2.5}
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
              
              Pending Approval
            </Typography>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 800,
                color: '#D97706'
              }}>
              
              3
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
              
              Approved (Q4)
            </Typography>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 800,
                color: '#16A34A'
              }}>
              
              3
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
              
              Exported (Q4)
            </Typography>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 800
              }}>
              
              2
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
              
              Total Value (Q4)
            </Typography>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 800
              }}>
              
              $400.1M
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
          
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab label="All" />
            <Tab label="Pending approval" />
            <Tab label="Approved" />
            <Tab label="Exported" />
          </Tabs>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" startIcon={<PlayArrowIcon />}>
              Generate Q4 invoices
            </Button>
            <Button
              variant="outlined"
              startIcon={<CheckIcon />}
              disabled={!selected.length}>
              
              Approve selected ({selected.length})
            </Button>
            <Button variant="outlined" startIcon={<FileDownloadIcon />}>
              Export
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
              minWidth: 900
            }}>
            
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox"></TableCell>
                <TableCell>Invoice ID</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Payor</TableCell>
                <TableCell>Payee</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Currency</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((inv) =>
              <TableRow key={inv.id} hover>
                  <TableCell padding="checkbox">
                    <Checkbox
                    checked={selected.includes(inv.id)}
                    onChange={() => toggle(inv.id)} />
                  
                  </TableCell>
                  <TableCell
                  sx={{
                    fontWeight: 700
                  }}>
                  
                    {inv.id}
                  </TableCell>
                  <TableCell>{inv.date}</TableCell>
                  <TableCell>{inv.payor}</TableCell>
                  <TableCell>{inv.payee}</TableCell>
                  <TableCell>{inv.type}</TableCell>
                  <TableCell
                  align="right"
                  sx={{
                    fontVariantNumeric: 'tabular-nums'
                  }}>
                  
                    {new Intl.NumberFormat('en-US').format(inv.amount)}
                  </TableCell>
                  <TableCell>{inv.currency}</TableCell>
                  <TableCell>
                    <Chip
                    label={inv.status}
                    size="small"
                    sx={{
                      bgcolor: statusStyle[inv.status].bg,
                      color: statusStyle[inv.status].color,
                      fontWeight: 700
                    }} />
                  
                  </TableCell>
                  <TableCell align="right">
                    <Stack
                    direction="row"
                    spacing={0.5}
                    justifyContent="flex-end">
                    
                      <Button size="small" variant="outlined">
                        View
                      </Button>
                      {inv.status === 'Pending Approval' &&
                    <Button size="small" variant="contained">
                          Approve
                        </Button>
                    }
                    </Stack>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </Paper>
    </AppShell>);

}