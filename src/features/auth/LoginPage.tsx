import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Paper,
  Typography,
  Button,
  Stack,
  TextField,
  Divider,
  Link as MuiLink,
  Chip } from
'@mui/material';
import LoginIcon from '@mui/icons-material/Login';
import MicrosoftIcon from '@mui/icons-material/Microsoft';
import PsychologyIcon from '@mui/icons-material/Psychology';
export default function Login() {
  const navigate = useNavigate();
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        bgcolor: '#F8FAFC'
      }}>
      
      {/* Left: brand panel */}
      <Box
        sx={{
          flex: 1,
          display: {
            xs: 'none',
            md: 'flex'
          },
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: 6,
          bgcolor: '#0F172A',
          color: 'white'
        }}>
        
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 1,
              bgcolor: '#2563EB',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800
            }}>
            
            O
          </Box>
          <Typography
            variant="h6"
            sx={{
              fontWeight: 700
            }}>
            
            OTP Platform
          </Typography>
          <Chip
            label="by Aperture Tax"
            size="small"
            sx={{
              bgcolor: '#1E293B',
              color: '#94A3B8'
            }} />
          
        </Stack>

        <Box
          sx={{
            maxWidth: 480
          }}>
          
          <Typography
            variant="h3"
            sx={{
              fontWeight: 800,
              letterSpacing: '-0.02em',
              mb: 2
            }}>
            
            Operational transfer pricing,{' '}
            <Box
              component="span"
              sx={{
                color: '#60A5FA'
              }}>
              
              automated end-to-end.
            </Box>
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: '#CBD5E1',
              mb: 3
            }}>
            
            Replace spreadsheets with real-time monitoring, automated
            adjustments, and in-context intelligence from Research Brain —
            powered by the firm's proprietary TP IP.
          </Typography>
          <Stack direction="row" spacing={2} alignItems="center">
            <PsychologyIcon
              sx={{
                color: '#60A5FA'
              }} />
            
            <Typography
              variant="body2"
              sx={{
                color: '#CBD5E1'
              }}>
              
              Ask jurisdiction-specific TP questions in plain English. Get cited
              answers in seconds.
            </Typography>
          </Stack>
        </Box>

        <Typography
          variant="caption"
          sx={{
            color: '#64748B'
          }}>
          
          SOC 2 Type II · ISO 27001 · GDPR · SSO via SAML & OIDC
        </Typography>
      </Box>

      {/* Right: login form */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 3
        }}>
        
        <Paper
          sx={{
            width: '100%',
            maxWidth: 440,
            p: {
              xs: 3,
              sm: 4.5
            }
          }}>
          
          <Typography
            variant="h4"
            sx={{
              fontWeight: 800,
              mb: 0.5
            }}>
            
            Sign in
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: '#64748B',
              mb: 3
            }}>
            
            Access your organization's OTP workspace.
          </Typography>

          <Stack spacing={1.5}>
            <Button
              variant="contained"
              size="large"
              startIcon={<LoginIcon />}
              onClick={() => navigate('/onboarding')}
              sx={{
                bgcolor: '#2563EB',
                '&:hover': {
                  bgcolor: '#1D4ED8'
                },
                py: 1.25
              }}>
              
              Sign in with Enterprise SSO
            </Button>
            <Button
              variant="outlined"
              size="large"
              startIcon={<MicrosoftIcon />}
              onClick={() => navigate('/onboarding')}
              sx={{
                py: 1.25
              }}>
              
              Continue with Microsoft
            </Button>
          </Stack>

          <Divider
            sx={{
              my: 3
            }}>
            
            <Typography
              variant="caption"
              sx={{
                color: '#94A3B8'
              }}>
              
              or sign in with email
            </Typography>
          </Divider>

          <Stack spacing={2}>
            <TextField
              label="Work email"
              placeholder="maria.chen@company.com"
              size="small"
              fullWidth />
            
            <TextField
              label="Password"
              type="password"
              size="small"
              fullWidth />
            
            <Button variant="text" onClick={() => navigate('/home')}>
              Sign in with email
            </Button>
          </Stack>

          <Divider
            sx={{
              my: 3
            }} />
          
          <Button
            fullWidth
            variant="contained"
            color="secondary"
            onClick={() => navigate('/home')}>
            
            Enter Demo Workspace →
          </Button>
          <Typography
            variant="caption"
            sx={{
              color: '#94A3B8',
              display: 'block',
              textAlign: 'center',
              mt: 1.5
            }}>
            
            Demo workspace is pre-loaded with a 20-entity MNE and sample
            intercompany data.
          </Typography>
          <Typography
            variant="caption"
            sx={{
              color: '#94A3B8',
              display: 'block',
              textAlign: 'center',
              mt: 2
            }}>
            
            Need help? <MuiLink href="#">Contact your administrator</MuiLink>
          </Typography>
        </Paper>
      </Box>
    </Box>);

}