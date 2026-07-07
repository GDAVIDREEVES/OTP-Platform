import React, { Suspense, lazy } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useParams,
} from 'react-router-dom';
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
import { WorkSignalsProvider } from '@/shared/providers/WorkSignalsProvider';
import { ReviewHandoffProvider } from '@/kernel/review/ReviewHandoff';
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
const ResearchBrain = lazy(() => import('@/features/research-brain/ResearchBrainPage'));
const ProcessLibrary = lazy(() => import('@/kernel/navigation/ProcessLibraryPage'));
const ProcessShellRoute = lazy(() => import('@/kernel/shell/ProcessShell'));
const ReviewQueue = lazy(() => import('@/kernel/review/ReviewQueuePage'));
const Home = lazy(() => import('@/kernel/home/OperatingCadenceHome'));
const Director = lazy(() => import('@/kernel/director/ExposureDashboard'));
const EvidencePacketPage = lazy(() => import('@/kernel/audit/EvidencePacket'));
const MasterData = lazy(() => import('@/features/master-data/MasterDataWorkspace'));
const CalcStudio = lazy(() => import('@/features/calc-studio/CalcStudioWorkspace'));

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

/** Legacy `/adjustment/:id` is retired — the canonical in-period adjustment is
 *  the OTP-16 guided process (draft persistence, Research-Brain prepare,
 *  maker-checker handoff). Keep the path alive for bookmarks; bounce to OTP-16
 *  carrying the entity so the gap-to-range is pre-loaded. */
function AdjustmentRedirect() {
  const { id } = useParams();
  return (
    <Navigate
      to={`/process/OTP-16/overview?entity=${id ?? ''}`}
      replace
    />);
}

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <DataProvider>
          <SessionProvider>
          <WorkSignalsProvider>
          <ReviewHandoffProvider>
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
                {/* Retired legacy page — redirects into the OTP-16 process. */}
                <Route path="/adjustment/:id" element={<AdjustmentRedirect />} />
                <Route path="/research-brain" element={<ResearchBrain />} />
                <Route path="/process" element={<ProcessLibrary />} />
                <Route path="/process/:otpId" element={<ProcessShellRoute />} />
                <Route path="/process/:otpId/:tab" element={<ProcessShellRoute />} />
                <Route path="/review" element={<ReviewQueue />} />
                {/* The Inbox merged into /home ("My work"); keep the path alive for bookmarks. */}
                <Route path="/inbox" element={<Navigate to="/home" replace />} />
                <Route path="/director" element={<Director />} />
                <Route path="/master-data" element={<MasterData />} />
                <Route path="/master-data/:tab" element={<MasterData />} />
                <Route path="/calc-studio" element={<CalcStudio />} />
                <Route path="/calc-studio/:tab" element={<CalcStudio />} />
                <Route path="/evidence/:ref" element={<EvidencePacketPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
            </ErrorBoundary>
            <CommandPalette />
          </ResearchBrainProvider>
          </ReviewHandoffProvider>
          </WorkSignalsProvider>
          </SessionProvider>
        </DataProvider>
      </BrowserRouter>
    </ThemeProvider>);
}
