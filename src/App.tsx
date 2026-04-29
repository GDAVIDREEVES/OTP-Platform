import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import {
  ThemeProvider,
  CssBaseline,
  Box,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import { theme } from './components/theme';
import { ResearchBrainProvider } from './components/research-brain/ResearchBrainContext';
import { DataProvider } from './data/DataProvider';

// Each route is a separate JS chunk loaded on first navigation.
// This keeps the initial bundle small (login + dashboard only) and pays the
// download cost lazily as the user moves through the app.
const Login = lazy(() => import('./pages/Login'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Policy = lazy(() => import('./pages/Policy'));
const PriceSetting = lazy(() => import('./pages/PriceSetting'));
const SegmentedPnL = lazy(() => import('./pages/SegmentedPnL'));
const Royalties = lazy(() => import('./pages/Royalties'));
const Invoicing = lazy(() => import('./pages/Invoicing'));
const Reports = lazy(() => import('./pages/Reports'));
const Settings = lazy(() => import('./pages/Settings'));
const EntityDetail = lazy(() => import('./pages/EntityDetail'));
const Adjustment = lazy(() => import('./pages/Adjustment'));
const ResearchBrain = lazy(() => import('./pages/ResearchBrain'));

function RouteFallback() {
  return (
    <Box
      sx={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Stack spacing={1.5} alignItems="center">
        <CircularProgress size={28} />
        <Typography variant="caption" sx={{ color: '#64748B' }}>
          Loading…
        </Typography>
      </Stack>
    </Box>);
}

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <DataProvider>
          <ResearchBrainProvider>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Login />} />
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/policy" element={<Policy />} />
                <Route path="/price-setting" element={<PriceSetting />} />
                <Route path="/segmented-pnl" element={<SegmentedPnL />} />
                <Route path="/royalties" element={<Royalties />} />
                <Route path="/invoicing" element={<Invoicing />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/entities/:id" element={<EntityDetail />} />
                <Route path="/adjustment/:id" element={<Adjustment />} />
                <Route path="/research-brain" element={<ResearchBrain />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </ResearchBrainProvider>
        </DataProvider>
      </BrowserRouter>
    </ThemeProvider>);
}
