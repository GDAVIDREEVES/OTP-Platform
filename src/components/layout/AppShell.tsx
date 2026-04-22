import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  AppBar,
  Toolbar,
  IconButton,
  Badge,
  Avatar,
  Select,
  MenuItem,
  FormControl,
  Chip,
  Stack,
  Divider,
  Tooltip,
  useMediaQuery } from
'@mui/material';
import { useTheme } from '@mui/material/styles';
import DashboardIcon from '@mui/icons-material/SpaceDashboard';
import CalculateIcon from '@mui/icons-material/Calculate';
import PolicyIcon from '@mui/icons-material/Policy';
import PieChartIcon from '@mui/icons-material/PieChart';
import PaidIcon from '@mui/icons-material/Paid';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import PsychologyIcon from '@mui/icons-material/Psychology';
import SummarizeIcon from '@mui/icons-material/Summarize';
import SettingsIcon from '@mui/icons-material/Settings';
import NotificationsIcon from '@mui/icons-material/Notifications';
import MenuIcon from '@mui/icons-material/Menu';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import ResearchBrainFab from '../research-brain/ResearchBrainFab';
import ResearchBrainPanel from '../research-brain/ResearchBrainPanel';
const DRAWER_WIDTH = 248;
const navItems = [
{
  label: 'Dashboard',
  icon: <DashboardIcon />,
  path: '/dashboard'
},
{
  label: 'Price Setting',
  icon: <CalculateIcon />,
  path: '/price-setting'
},
{
  label: 'Policy',
  icon: <PolicyIcon />,
  path: '/policy'
},
{
  label: 'Segmented P&L',
  icon: <PieChartIcon />,
  path: '/segmented-pnl'
},
{
  label: 'Royalties',
  icon: <PaidIcon />,
  path: '/royalties'
},
{
  label: 'Invoicing',
  icon: <ReceiptLongIcon />,
  path: '/invoicing'
},
{
  label: 'Research Brain',
  icon: <PsychologyIcon />,
  path: '/research-brain'
},
{
  label: 'Reports',
  icon: <SummarizeIcon />,
  path: '/reports'
},
{
  label: 'Settings',
  icon: <SettingsIcon />,
  path: '/settings'
}];

interface Props {
  pageTitle: string;
  children: React.ReactNode;
}
export default function AppShell({ pageTitle, children }: Props) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawer =
  <Box
    sx={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      bgcolor: '#0F172A',
      color: '#E2E8F0'
    }}>
    
      <Box
      sx={{
        px: 2.5,
        py: 2.5,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5
      }}>
      
        <Box
        sx={{
          width: 32,
          height: 32,
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
        <Box>
          <Typography
          variant="subtitle2"
          sx={{
            color: 'white',
            fontWeight: 700,
            lineHeight: 1.1
          }}>
          
            OTP Platform
          </Typography>
          <Typography
          variant="caption"
          sx={{
            color: '#94A3B8'
          }}>
          
            by Aperture Tax
          </Typography>
        </Box>
      </Box>
      <Divider
      sx={{
        borderColor: '#1E293B'
      }} />
    
      <List
      sx={{
        flex: 1,
        px: 1.5,
        py: 2
      }}>
      
        {navItems.map((item) => {
        const active = location.pathname.startsWith(item.path);
        return (
          <ListItemButton
            key={item.path}
            component={Link}
            to={item.path}
            onClick={() => isMobile && setMobileOpen(false)}
            sx={{
              borderRadius: 1.5,
              mb: 0.5,
              py: 1,
              px: 1.5,
              color: active ? 'white' : '#94A3B8',
              bgcolor: active ? 'rgba(37, 99, 235, 0.18)' : 'transparent',
              '&:hover': {
                bgcolor: active ?
                'rgba(37, 99, 235, 0.25)' :
                'rgba(255,255,255,0.04)',
                color: 'white'
              }
            }}>
            
              <ListItemIcon
              sx={{
                minWidth: 36,
                color: active ? '#60A5FA' : '#64748B'
              }}>
              
                {item.icon}
              </ListItemIcon>
              <ListItemText
              primary={item.label}
              primaryTypographyProps={{
                fontSize: 14,
                fontWeight: active ? 600 : 500
              }} />
            
            </ListItemButton>);

      })}
      </List>
      <Divider
      sx={{
        borderColor: '#1E293B'
      }} />
    
      <Box
      sx={{
        px: 2,
        py: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5
      }}>
      
        <Avatar
        sx={{
          bgcolor: '#2563EB',
          width: 36,
          height: 36,
          fontSize: 14
        }}>
        
          MC
        </Avatar>
        <Box
        sx={{
          flex: 1,
          minWidth: 0
        }}>
        
          <Typography
          variant="body2"
          sx={{
            color: 'white',
            fontWeight: 600,
            lineHeight: 1.2
          }}>
          
            Maria Chen
          </Typography>
          <Typography
          variant="caption"
          sx={{
            color: '#94A3B8'
          }}>
          
            Group TP Manager
          </Typography>
        </Box>
        <IconButton
        size="small"
        sx={{
          color: '#64748B'
        }}
        onClick={() => navigate('/settings')}
        aria-label="Settings">
        
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>;

  return (
    <Box
      sx={{
        display: 'flex',
        minHeight: '100vh',
        bgcolor: '#F8FAFC'
      }}>
      
      <Box
        component="nav"
        sx={{
          width: {
            md: DRAWER_WIDTH
          },
          flexShrink: {
            md: 0
          }
        }}>
        
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{
            keepMounted: true
          }}
          sx={{
            display: {
              xs: 'block',
              md: 'none'
            },
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              border: 0
            }
          }}>
          
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: {
              xs: 'none',
              md: 'block'
            },
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              border: 0,
              position: 'fixed',
              height: '100vh'
            }
          }}>
          
          {drawer}
        </Drawer>
      </Box>

      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column'
        }}>
        
        <AppBar
          position="sticky"
          elevation={0}
          sx={{
            bgcolor: 'white',
            color: '#0F172A',
            borderBottom: '1px solid #E2E8F0'
          }}>
          
          <Toolbar
            sx={{
              gap: 2,
              minHeight: {
                xs: 60,
                md: 68
              }
            }}>
            
            <IconButton
              edge="start"
              onClick={() => setMobileOpen(true)}
              sx={{
                display: {
                  md: 'none'
                }
              }}
              aria-label="Open navigation">
              
              <MenuIcon />
            </IconButton>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                flex: 1,
                fontSize: {
                  xs: 16,
                  md: 18
                }
              }}>
              
              {pageTitle}
            </Typography>

            <Stack direction="row" spacing={1.5} alignItems="center">
              <FormControl
                size="small"
                sx={{
                  display: {
                    xs: 'none',
                    sm: 'block'
                  },
                  minWidth: 180
                }}>
                
                <Select
                  defaultValue="q4"
                  sx={{
                    fontSize: 14,
                    bgcolor: '#F8FAFC'
                  }}>
                  
                  <MenuItem value="q4">FY2025 — Q4 (Oct–Dec)</MenuItem>
                  <MenuItem value="q3">FY2025 — Q3 (Jul–Sep)</MenuItem>
                  <MenuItem value="q2">FY2025 — Q2 (Apr–Jun)</MenuItem>
                  <MenuItem value="q1">FY2025 — Q1 (Jan–Mar)</MenuItem>
                  <MenuItem value="fy">FY2025 — Full Year</MenuItem>
                </Select>
              </FormControl>

              <Chip
                icon={
                <CloudDoneIcon
                  sx={{
                    fontSize: 16,
                    color: '#16A34A !important'
                  }} />

                }
                label="Last synced 4 min ago"
                size="small"
                sx={{
                  display: {
                    xs: 'none',
                    lg: 'flex'
                  },
                  bgcolor: '#F8FAFC',
                  color: '#475569',
                  border: '1px solid #E2E8F0',
                  fontWeight: 500
                }} />
              

              <Tooltip title="Notifications">
                <IconButton aria-label="Notifications">
                  <Badge badgeContent={3} color="error">
                    <NotificationsIcon />
                  </Badge>
                </IconButton>
              </Tooltip>

              <Avatar
                sx={{
                  bgcolor: '#2563EB',
                  width: 36,
                  height: 36,
                  fontSize: 14
                }}>
                
                MC
              </Avatar>
            </Stack>
          </Toolbar>
        </AppBar>

        <Box
          component="main"
          sx={{
            flex: 1,
            p: {
              xs: 2,
              md: 3
            },
            minWidth: 0
          }}>
          
          {children}
        </Box>
      </Box>

      <ResearchBrainFab />
      <ResearchBrainPanel />
    </Box>);

}