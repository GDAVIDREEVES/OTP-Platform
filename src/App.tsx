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
import { theme } from '@/shared/theme';
import { ResearchBrainProvider } from '@/features/research-brain/ResearchBrainContext';
import { DataProvider } from '@/shared/providers/DataProvider';
import { SessionProvider } from '@/shared/providers/SessionProvider';
import CommandPalette from '@/kernel/navigation/CommandPalette';
import ErrorBoundary from '@/shared/components/ErrorBoundary';

// Each route is a separate JS chunk loaded on first navigation.
// This keeps the initial bundle small (login + dashboard only) and pays the
// download cost lazily as the user moves through the app.
const Login = lazy(() => import('@/features/auth/LoginPage'));
const Onboarding = lazy(() => import('@/features/onboarding/OnboardingPage'));
const Dashboard = lazy(() => import('@/features/dashboard/DashboardPage'));
const Policy = lazy(() => import('@/features/policy/PolicyPage'));
const PriceSetting = lazy(() => import('@/features/pricing/PriceSettingPage'));
const SegmentedPnL = lazy(() => import('@/features/pnl/SegmentedPnLPage'));
const Royalties = lazy(() => import('@/features/royalties/RoyaltiesPage'));
const Invoicing = lazy(() => import('@/features/invoicing/InvoicingPage'));
const Reports = lazy(() => import('@/features/reports/ReportsPage'));
const Settings = lazy(() => import('@/features/settings/SettingsPage'));
const EntityDetail = lazy(() => import('@/features/entities/EntityDetailPage'));
const Adjustment = lazy(() => import('@/features/adjustment/AdjustmentPage'));
const ResearchBrain = lazy(() => import('@/features/research-brain/ResearchBrainPage'));
const ProcessLibrary = lazy(() => import('@/kernel/navigation/ProcessLibraryPage'));
const ProcessShellRoute = lazy(() => import('@/kernel/shell/ProcessShell'));
const ReviewQueue = lazy(() => import('@/kernel/review/ReviewQueuePage'));
const Home = lazy(() => import('@/kernel/home/OperatingCadenceHome'));
const Director = lazy(() => import('@/kernel/director/ExposureDashboard'));
const EvidencePacketPage = lazy(() => import('@/kernel/audit/EvidencePacket'));
const MasterData = lazy(() => import('@/features/master-data/MasterDataWorkspace'));

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
          <SessionProvider>
          <ResearchBrainProvider>
            <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Login />} />
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/home" element={<Home />} />
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
                <Route path="/process" element={<ProcessLibrary />} />
                <Route path="/process/:otpId" element={<ProcessShellRoute />} />
                <Route path="/process/:otpId/:tab" element={<ProcessShellRoute />} />
                <Route path="/review" element={<ReviewQueue />} />
                <Route path="/director" element={<Director />} />
                <Route path="/master-data" element={<MasterData />} />
                <Route path="/master-data/:tab" element={<MasterData />} />
                <Route path="/evidence/:ref" element={<EvidencePacketPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
            </ErrorBoundary>
            <CommandPalette />
          </ResearchBrainProvider>
          </SessionProvider>
        </DataProvider>
      </BrowserRouter>
    </ThemeProvider>);
}
