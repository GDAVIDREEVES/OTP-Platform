import React, { useEffect, useState } from 'react';
import AppShell from '@/shared/components/layout/AppShell';
import {
  Paper,
  Typography,
  Grid,
  Stack,
  TextField,
  Button,
  Chip,
  Box,
  Switch,
  FormControlLabel,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Avatar } from
'@mui/material';
import { useSettings } from '@/shared/providers/DataProvider';
import { useSaveSettings } from '@/shared/hooks/useSaveSettings';
import { useSession } from '@/shared/providers/SessionProvider';
const connectors = [
{
  name: 'SAP S/4HANA — PROD',
  status: 'Healthy',
  lastSync: '4 min ago'
},
{
  name: 'Oracle ERP Cloud — EMEA',
  status: 'Healthy',
  lastSync: '12 min ago'
},
{
  name: 'Snowflake — Analytics Warehouse',
  status: 'Healthy',
  lastSync: '3 min ago'
},
{
  name: 'Databricks — Lakehouse',
  status: 'Degraded',
  lastSync: '2 hr ago'
}];

export default function Settings() {
  const initial = useSettings();
  const { save, pending } = useSaveSettings();
  const { users, role } = useSession();
  const [companyName, setCompanyName] = useState(initial.companyName);
  const [defaultCurrency, setDefaultCurrency] = useState(initial.defaultCurrency);
  const [defaultReviewer, setDefaultReviewer] = useState(initial.defaultReviewer);
  const [notifyOnDeviation, setNotifyOnDeviation] = useState(initial.notifyOnDeviation);
  const dirty =
    companyName !== initial.companyName ||
    defaultCurrency !== initial.defaultCurrency ||
    defaultReviewer !== initial.defaultReviewer ||
    notifyOnDeviation !== initial.notifyOnDeviation;
  // If a refetch updates the cached settings, sync local state
  useEffect(() => {
    setCompanyName(initial.companyName);
    setDefaultCurrency(initial.defaultCurrency);
    setDefaultReviewer(initial.defaultReviewer);
    setNotifyOnDeviation(initial.notifyOnDeviation);
  }, [initial.companyName, initial.defaultCurrency, initial.defaultReviewer, initial.notifyOnDeviation]);
  return (
    <AppShell pageTitle="Settings">
      <Grid container spacing={2.5}>
        <Grid item xs={12} md={6}>
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
              
              Organization
            </Typography>
            <Stack spacing={2}>
              <TextField
                label="Organization name"
                size="small"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                fullWidth />

              <TextField
                label="Functional currency"
                size="small"
                value={defaultCurrency}
                onChange={(e) => setDefaultCurrency(e.target.value)}
                fullWidth />

              <TextField
                label="Default reviewer"
                size="small"
                value={defaultReviewer}
                onChange={(e) => setDefaultReviewer(e.target.value)}
                helperText="Used as the default sign-off on adjustments and policy edits."
                fullWidth />

              <FormControlLabel
                control={
                  <Switch
                    checked={notifyOnDeviation}
                    onChange={(e) => setNotifyOnDeviation(e.target.checked)} />
                }
                label="Notify on out-of-range deviations" />

              <Stack direction="row" spacing={1.5} justifyContent="flex-end">
                <Button
                  variant="contained"
                  disabled={!dirty || pending}
                  onClick={() =>
                    save({
                      companyName,
                      defaultCurrency,
                      defaultReviewer,
                      notifyOnDeviation,
                    })
                  }>
                  {pending ? 'Saving…' : 'Save settings'}
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
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
              
              Security
            </Typography>
            <Stack spacing={1.5}>
              {[
                'Enforce SSO (SAML 2.0)',
                'Require MFA for Tax Director role',
                'IP allowlist enabled'].
              map((label) =>
              <Stack
                key={label}
                direction="row"
                justifyContent="space-between"
                alignItems="center">

                  <Typography variant="body2">{label}</Typography>
                  <Chip
                  label="Enforced"
                  size="small"
                  sx={{
                    bgcolor: '#DCFCE7',
                    color: '#15803D',
                    fontWeight: 700
                  }} />

                </Stack>
              )}
            </Stack>
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

                Users & roles
              </Typography>
            </Stack>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>User</TableCell>
                  <TableCell>Title</TableCell>
                  <TableCell>Role</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((u) =>
                <TableRow key={u.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <Avatar
                        sx={{
                          width: 28,
                          height: 28,
                          bgcolor: '#2563EB',
                          fontSize: 12
                        }}>

                          {u.initials}
                        </Avatar>
                        <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 600
                        }}>

                          {u.name}
                        </Typography>
                        {u.role === role &&
                        <Chip
                          label="You"
                          size="small"
                          sx={{
                            height: 18,
                            fontSize: 10,
                            bgcolor: '#EFF6FF',
                            color: '#1D4ED8',
                            fontWeight: 700
                          }} />
                        }
                      </Stack>
                    </TableCell>
                    <TableCell
                    sx={{
                      color: '#64748B'
                    }}>

                      {u.title}
                    </TableCell>
                    <TableCell>
                      <Chip
                      label={u.role}
                      size="small"
                      sx={{
                        bgcolor: '#DCFCE7',
                        color: '#15803D',
                        fontWeight: 700,
                        textTransform: 'capitalize'
                      }} />

                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        </Grid>

        <Grid item xs={12}>
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
              
              Connector health
            </Typography>
            <Grid container spacing={2}>
              {connectors.map((c) =>
              <Grid item xs={12} md={6} key={c.name}>
                  <Paper
                  variant="outlined"
                  sx={{
                    p: 2
                  }}>
                  
                    <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center">
                    
                      <Box>
                        <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 700
                        }}>
                        
                          {c.name}
                        </Typography>
                        <Typography
                        variant="caption"
                        sx={{
                          color: '#64748B'
                        }}>
                        
                          Last sync {c.lastSync}
                        </Typography>
                      </Box>
                      <Chip
                      label={c.status}
                      size="small"
                      sx={{
                        bgcolor:
                        c.status === 'Healthy' ? '#DCFCE7' : '#FEF3C7',
                        color: c.status === 'Healthy' ? '#15803D' : '#B45309',
                        fontWeight: 700
                      }} />
                    
                    </Stack>
                  </Paper>
                </Grid>
              )}
            </Grid>
          </Paper>
        </Grid>
      </Grid>
    </AppShell>);

}