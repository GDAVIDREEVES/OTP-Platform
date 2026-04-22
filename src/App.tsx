import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { theme } from './components/theme';
import { ResearchBrainProvider } from './components/research-brain/ResearchBrainContext';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import Policy from './pages/Policy';
import PriceSetting from './pages/PriceSetting';
import SegmentedPnL from './pages/SegmentedPnL';
import Royalties from './pages/Royalties';
import Invoicing from './pages/Invoicing';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import EntityDetail from './pages/EntityDetail';
import Adjustment from './pages/Adjustment';
import ResearchBrain from './pages/ResearchBrain';
export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <ResearchBrainProvider>
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
        </ResearchBrainProvider>
      </BrowserRouter>
    </ThemeProvider>);

}