import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Paper,
  Typography,
  Stepper,
  Step,
  StepLabel,
  Button,
  Stack,
  Grid,
  Chip,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  Avatar,
  Divider,
  Radio,
  RadioGroup,
  Alert } from
'@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import CloudIcon from '@mui/icons-material/Cloud';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useSession, USERS, type Role } from '@/shared/providers/SessionProvider';

const ONBOARDING_ROLES: Role[] = ['operator', 'reviewer', 'director'];
const connectors = [
{
  id: 'sap-s4',
  name: 'SAP S/4HANA',
  icon: '🟢',
  desc: 'Real-time intercompany & GL data',
  pill: 'Recommended'
},
{
  id: 'sap-ecc',
  name: 'SAP ECC',
  icon: '🔵',
  desc: 'BSEG, VBRK/VBRP, EKKO/EKPO extraction'
},
{
  id: 'oracle',
  name: 'Oracle ERP Cloud',
  icon: '🔴',
  desc: 'REST APIs for IC subledger & journals'
},
{
  id: 'databricks',
  name: 'Databricks Delta Lake',
  icon: '🟣',
  desc: 'Spark-based lakehouse connector'
},
{
  id: 'snowflake',
  name: 'Snowflake',
  icon: '🔷',
  desc: 'Direct SQL / Data Sharing'
},
{
  id: 'flatfile',
  name: 'Flat File / CSV',
  icon: '📄',
  desc: 'Fallback for legacy ERP systems'
}];

const policyTemplates = [
{
  id: 'lrd-tnmm',
  name: 'LRD — TNMM (Distribution)',
  range: '4–7% OM',
  method: 'TNMM'
},
{
  id: 'mfg-cp',
  name: 'Contract Manufacturer — Cost Plus',
  range: '5–9%',
  method: 'Cost Plus'
},
{
  id: 'svc-cp',
  name: 'Shared Services — Cost Plus',
  range: '5–8%',
  method: 'Cost Plus'
},
{
  id: 'rnd-cp',
  name: 'Contract R&D — Cost Plus',
  range: '7–10%',
  method: 'Cost Plus'
},
{
  id: 'ip-cut',
  name: 'IP Royalty — CUT/CUP',
  range: '2.5–7.5%',
  method: 'CUT/CUP'
}];

const steps = [
'ERP Connector',
'TP Policy Configuration',
'Role & Notifications'];

export default function Onboarding() {
  const navigate = useNavigate();
  const { role, setRole } = useSession();
  const [step, setStep] = useState(0);
  const [policyFile, setPolicyFile] = useState<File | null>(null);
  const policyInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedRole, setSelectedRole] = useState<Role>(role);
  const [connector, setConnector] = useState('sap-s4');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([
  'lrd-tnmm',
  'mfg-cp',
  'svc-cp']
  );
  const connect = () => {
    setConnecting(true);
    setTimeout(() => {
      setConnecting(false);
      setConnected(true);
    }, 1400);
  };
  const toggleTemplate = (id: string) => {
    setSelectedTemplates((s) =>
    s.includes(id) ? s.filter((t) => t !== id) : [...s, id]
    );
  };
  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: '#F8FAFC',
        py: 6
      }}>
      
      <Box
        sx={{
          maxWidth: 960,
          mx: 'auto',
          px: 3
        }}>
        
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.5}
          sx={{
            mb: 3
          }}>
          
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 1,
              bgcolor: '#2563EB',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 800
            }}>
            
            O
          </Box>
          <Typography
            variant="h5"
            sx={{
              fontWeight: 700
            }}>
            
            OTP Platform — Setup
          </Typography>
        </Stack>

        <Paper
          sx={{
            p: {
              xs: 3,
              md: 4
            }
          }}>
          
          <Stepper
            activeStep={step}
            alternativeLabel
            sx={{
              mb: 4
            }}>
            
            {steps.map((s) =>
            <Step key={s}>
                <StepLabel>{s}</StepLabel>
              </Step>
            )}
          </Stepper>

          {step === 0 &&
          <Box>
              <Typography
              variant="h5"
              sx={{
                fontWeight: 700,
                mb: 0.5
              }}>
              
                Connect your ERP or data warehouse
              </Typography>
              <Typography
              variant="body2"
              sx={{
                color: '#64748B',
                mb: 3
              }}>
              
                We'll ingest intercompany transactions, entities, and
                financials. Most connectors complete their first full sync
                within 48 hours.
              </Typography>

              <Grid container spacing={2}>
                {connectors.map((c) =>
              <Grid item xs={12} sm={6} md={4} key={c.id}>
                    <Paper
                  variant="outlined"
                  onClick={() => setConnector(c.id)}
                  sx={{
                    p: 2,
                    cursor: 'pointer',
                    height: '100%',
                    borderColor: connector === c.id ? '#2563EB' : '#E2E8F0',
                    borderWidth: connector === c.id ? 2 : 1,
                    bgcolor: connector === c.id ? '#EFF6FF' : 'white'
                  }}>
                  
                      <Stack
                    direction="row"
                    alignItems="flex-start"
                    justifyContent="space-between"
                    sx={{
                      mb: 1
                    }}>
                    
                        <Avatar
                      sx={{
                        bgcolor: '#F1F5F9',
                        color: '#0F172A',
                        fontSize: 18
                      }}>
                      
                          {c.icon}
                        </Avatar>
                        {c.pill &&
                    <Chip
                      label={c.pill}
                      size="small"
                      sx={{
                        bgcolor: '#DCFCE7',
                        color: '#15803D',
                        fontWeight: 700,
                        fontSize: 10
                      }} />

                    }
                      </Stack>
                      <Typography
                    variant="subtitle2"
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
                    
                        {c.desc}
                      </Typography>
                    </Paper>
                  </Grid>
              )}
              </Grid>

              <Paper
              variant="outlined"
              sx={{
                p: 2.5,
                mt: 3,
                bgcolor: '#F8FAFC'
              }}>
              
                <Typography
                variant="subtitle2"
                sx={{
                  fontWeight: 700,
                  mb: 1.5
                }}>
                
                  Connection Details
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                    label="Endpoint URL"
                    placeholder="https://sap.company.com/sap/opu/odata"
                    size="small"
                    fullWidth />
                  
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                    label="Client ID"
                    placeholder="100"
                    size="small"
                    fullWidth />
                  
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField label="Service User" size="small" fullWidth />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                    label="Credentials"
                    type="password"
                    size="small"
                    fullWidth />
                  
                  </Grid>
                </Grid>
                <Stack
                direction="row"
                spacing={1.5}
                alignItems="center"
                sx={{
                  mt: 2
                }}>
                
                  <Button
                  variant="contained"
                  onClick={connect}
                  disabled={connecting || connected}>
                  
                    {connected ?
                  'Connected' :
                  connecting ?
                  'Connecting…' :
                  'Test & Connect'}
                  </Button>
                  {connecting &&
                <LinearProgress
                  sx={{
                    flex: 1,
                    maxWidth: 220
                  }} />

                }
                  {connected &&
                <Stack direction="row" alignItems="center" spacing={0.75}>
                      <CheckCircleIcon
                    sx={{
                      color: '#16A34A',
                      fontSize: 18
                    }} />
                  
                      <Typography
                    variant="body2"
                    sx={{
                      color: '#16A34A',
                      fontWeight: 600
                    }}>
                    
                        Healthy · 20 entities detected · 3.2M transactions
                      </Typography>
                    </Stack>
                }
                </Stack>
              </Paper>
            </Box>
          }

          {step === 1 &&
          <Box>
              <Typography
              variant="h5"
              sx={{
                fontWeight: 700,
                mb: 0.5
              }}>
              
                Configure TP policies
              </Typography>
              <Typography
              variant="body2"
              sx={{
                color: '#64748B',
                mb: 3
              }}>
              
                Apply firm-recommended templates to the intercompany flows we
                detected. You can refine each policy later.
              </Typography>

              <Alert
              severity="info"
              sx={{
                mb: 3
              }}>
              
                We identified <b>10 intercompany flows</b> across your 20
                entities. Apply a template to pre-fill pricing methods and arm's
                length ranges.
              </Alert>

              <Stack spacing={1.25}>
                {policyTemplates.map((t) =>
              <Paper
                key={t.id}
                variant="outlined"
                sx={{
                  p: 2
                }}>
                
                    <Stack direction="row" alignItems="center" spacing={2}>
                      <Checkbox
                    checked={selectedTemplates.includes(t.id)}
                    onChange={() => toggleTemplate(t.id)} />
                  
                      <Box
                    sx={{
                      flex: 1
                    }}>
                    
                        <Typography
                      variant="subtitle2"
                      sx={{
                        fontWeight: 700
                      }}>
                      
                          {t.name}
                        </Typography>
                        <Typography
                      variant="caption"
                      sx={{
                        color: '#64748B'
                      }}>
                      
                          Method: {t.method} · Benchmark range: {t.range}
                        </Typography>
                      </Box>
                      <Chip
                    label="Firm Template"
                    size="small"
                    sx={{
                      bgcolor: '#EFF6FF',
                      color: '#1D4ED8',
                      fontWeight: 700
                    }} />
                  
                    </Stack>
                  </Paper>
              )}
              </Stack>

              <Divider
              sx={{
                my: 3
              }} />
            
              <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                mb: 1.5
              }}>
              
                Import existing policy document (optional)
              </Typography>
              <input
                ref={policyInputRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                hidden
                onChange={(ev) => setPolicyFile(ev.target.files?.[0] ?? null)} />
              <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                <Button
                  variant="outlined"
                  startIcon={<UploadFileIcon />}
                  onClick={() => policyInputRef.current?.click()}>
                  {policyFile ? 'Replace policy document' : 'Upload policy .pdf or .docx'}
                </Button>
                {policyFile &&
                <Chip
                  label={`${policyFile.name} · ${(policyFile.size / 1024).toFixed(0)} KB`}
                  onDelete={() => {
                    setPolicyFile(null);
                    if (policyInputRef.current) policyInputRef.current.value = '';
                  }}
                  sx={{ bgcolor: '#DCFCE7', color: '#15803D', fontWeight: 600 }} />
                }
              </Stack>
              <Typography variant="caption" sx={{ color: '#94A3B8', display: 'block', mt: 1 }}>
                Kept in this browser session only — the demo does not upload documents to a server.
              </Typography>
            </Box>
          }

          {step === 2 &&
          <Box>
              <Typography
              variant="h5"
              sx={{
                fontWeight: 700,
                mb: 0.5
              }}>
              
                Role & notification preferences
              </Typography>
              <Typography
              variant="body2"
              sx={{
                color: '#64748B',
                mb: 3
              }}>
              
                Choose your role — we'll tailor the dashboard and alerts to
                match.
              </Typography>

              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Primary role</InputLabel>
                    <Select
                      value={selectedRole}
                      onChange={(e) => setSelectedRole(e.target.value as Role)}
                      label="Primary role">
                      {ONBOARDING_ROLES.map((r) =>
                      <MenuItem key={r} value={r}>
                          {USERS[r].name} — {USERS[r].title}
                        </MenuItem>
                      )}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Data region</InputLabel>
                    <Select defaultValue="eu" label="Data region">
                      <MenuItem value="us">United States</MenuItem>
                      <MenuItem value="eu">European Union</MenuItem>
                      <MenuItem value="apac">APAC (Singapore)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>

              <Divider
              sx={{
                my: 3
              }} />
            
              <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                mb: 1.5
              }}>
              
                Deviation alerts
              </Typography>
              <RadioGroup defaultValue="realtime">
                <FormControlLabel
                value="realtime"
                control={<Radio />}
                label="Real-time (in-app + email when a deviation occurs)" />
              
                <FormControlLabel
                value="daily"
                control={<Radio />}
                label="Daily digest" />
              
                <FormControlLabel
                value="weekly"
                control={<Radio />}
                label="Weekly summary" />
              
              </RadioGroup>

              <Divider
              sx={{
                my: 3
              }} />
            
              <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                mb: 1
              }}>
              
                Channels
              </Typography>
              <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
                <FormControlLabel
                control={<Checkbox defaultChecked />}
                label="In-app notifications" />
              
                <FormControlLabel
                control={<Checkbox defaultChecked />}
                label="Email" />
              
                <FormControlLabel
                control={<Checkbox />}
                label="Microsoft Teams" />
              
                <FormControlLabel control={<Checkbox />} label="Slack" />
              </Stack>
            </Box>
          }

          <Divider
            sx={{
              my: 4
            }} />
          
          <Stack direction="row" justifyContent="space-between">
            <Button
              startIcon={<ArrowBackIcon />}
              onClick={() =>
              step === 0 ? navigate('/') : setStep((s) => s - 1)
              }>
              
              {step === 0 ? 'Back to sign in' : 'Back'}
            </Button>
            <Button
              variant="contained"
              endIcon={<ArrowForwardIcon />}
              onClick={() => {
                if (step === 2) {
                  // Apply the chosen persona to the session BEFORE landing on
                  // /home, so the whole shell tailors to their role immediately.
                  setRole(selectedRole);
                  navigate('/home');
                } else {
                  setStep((s) => s + 1);
                }
              }}
              disabled={step === 0 && !connected}>

              {step === 2 ? 'Finish & Go to Home' : 'Continue'}
            </Button>
          </Stack>
        </Paper>
      </Box>
    </Box>);

}