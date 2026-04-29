/**
 * DataProvider — central read/write context for the React app.
 *
 * Responsibilities:
 *  - Bootstrap fetch (entities, flows, royalties, invoices, marginTrend, kpis,
 *    settings) on mount, and re-fetch whenever the global PeriodFilter changes.
 *  - Loading / error / refreshing UI gates.
 *  - Toast queue (any hook can call `toast.show("…", "error")`).
 *
 * Complex on-demand and mutation hooks live under `@/shared/hooks/`.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
} from 'react';
import {
  Box,
  CircularProgress,
  Stack,
  Typography,
  Alert,
  Button,
  Snackbar,
  IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { api } from '@/shared/api/client';
import type {
  KpiSummary,
  AppSettings,
} from '@/shared/api/types';
import type { Entity } from '@/shared/types/entity';
import type {
  TransactionFlow,
  Invoice,
  Royalty,
  MonthlyMarginRow,
} from '@/shared/types/transaction';
import type {
  PeriodKey,
  PeriodParams,
  PeriodSelection,
} from '@/shared/types/period';
import type { ToastApi, ToastSeverity } from '@/shared/types/toast';
import { buildPeriod } from '@/shared/utils/period';

interface DataState {
  entities: Entity[];
  flows: TransactionFlow[];
  royalties: Royalty[];
  invoices: Invoice[];
  marginTrend: MonthlyMarginRow[];
  kpis: KpiSummary;
  settings: AppSettings;
  /** Distinct fiscal years available in the data (newest first). */
  availableYears: number[];
  /** Wall-clock timestamp of the last successful load — for "as of" display. */
  lastFetchedAt: Date;
  /** Re-run all bootstrap fetches; surfaces success/failure as toasts. */
  refetch: () => Promise<void>;
  /** True only while a refetch is in flight (initial load uses the splash UI). */
  refreshing: boolean;
  toast: ToastApi;
  /** Active period filter applied to the bootstrap fetches. */
  period: PeriodSelection;
  setPeriod: (key: PeriodKey) => void;
  setYear: (year: number) => void;
}

const Ctx = createContext<DataState | null>(null);

interface QueuedToast {
  id: number;
  message: string;
  severity: ToastSeverity;
}

const DEFAULT_PERIOD = buildPeriod('fy', 2026);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<
    | (Omit<DataState, 'refetch' | 'refreshing' | 'toast' | 'period' | 'setPeriod' | 'setYear'>)
    | null
  >(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriodState] = useState<PeriodSelection>(DEFAULT_PERIOD);
  const [toasts, setToasts] = useState<QueuedToast[]>([]);
  const toastIdRef = useRef(0);

  // ------------------ toast queue ------------------
  const showToast = useCallback(
    (message: string, severity: ToastSeverity = 'info') => {
      toastIdRef.current += 1;
      const id = toastIdRef.current;
      setToasts((q) => [...q, { id, message, severity }]);
    },
    [],
  );
  const dismissToast = useCallback((id: number) => {
    setToasts((q) => q.filter((t) => t.id !== id));
  }, []);
  const toast: ToastApi = useMemo(() => ({ show: showToast }), [showToast]);

  // ------------------ bootstrap fetch ------------------
  const load = useCallback(
    async (isRefresh: boolean, periodArg: PeriodSelection) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      const pf: PeriodParams = {
        year: periodArg.year,
        periodFrom: periodArg.periodFrom,
        periodTo: periodArg.periodTo,
      };
      try {
        const [
          entities,
          flows,
          royalties,
          invoices,
          marginTrend,
          kpis,
          settings,
          availableYears,
        ] = await Promise.all([
          api.entities(pf),
          api.flows(pf),
          api.royalties(pf),
          api.invoices(pf),
          api.marginTrend(pf),
          api.kpis(pf),
          api.settings(),
          api.years().catch(() => [] as number[]),
        ]);
        setData({
          entities,
          flows,
          royalties,
          invoices,
          marginTrend,
          kpis,
          settings,
          availableYears,
          lastFetchedAt: new Date(),
        });
        if (isRefresh) showToast('Data refreshed from SAP', 'success');
      } catch (e) {
        const err = e as Error;
        setError(err);
        if (isRefresh) showToast(`Refresh failed: ${err.message}`, 'error');
      } finally {
        if (isRefresh) setRefreshing(false);
        else setLoading(false);
      }
    },
    [showToast],
  );

  const refetch = useCallback(() => load(true, period), [load, period]);

  /** Switch the global period filter; triggers a fresh bootstrap fetch. */
  const setPeriod = useCallback(
    (key: PeriodKey) => {
      const next = buildPeriod(key, period.year);
      setPeriodState(next);
      void load(true, next);
    },
    [load, period.year],
  );

  /** Switch the active fiscal year; preserves the current quarter selection. */
  const setYear = useCallback(
    (year: number) => {
      const next = buildPeriod(period.key, year);
      setPeriodState(next);
      void load(true, next);
    },
    [load, period.key],
  );

  useEffect(() => {
    void load(false, DEFAULT_PERIOD);
    // intentionally only on first mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------ render gates ------------------
  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: '#F8FAFC',
        }}
      >
        <Stack spacing={2} alignItems="center">
          <CircularProgress />
          <Typography variant="body2" sx={{ color: '#64748B' }}>
            Loading OTP data…
          </Typography>
        </Stack>
      </Box>
    );
  }

  if (error || !data) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: '#F8FAFC',
          p: 3,
        }}
      >
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => void load(false, period)}
            >
              Retry
            </Button>
          }
          sx={{ maxWidth: 640 }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
            Could not reach the OTP backend
          </Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {error?.message ?? 'Unknown error'}
          </Typography>
          <Typography variant="caption" sx={{ color: '#64748B' }}>
            Make sure the FastAPI server is running on{' '}
            <code>http://127.0.0.1:8000</code>. From{' '}
            <code>OTP-Platform/backend</code> run <code>python main.py</code>.
          </Typography>
        </Alert>
      </Box>
    );
  }

  const value: DataState = {
    ...data,
    refetch,
    refreshing,
    toast,
    period,
    setPeriod,
    setYear,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {toasts.map((t, i) => (
        <Snackbar
          key={t.id}
          open
          autoHideDuration={t.severity === 'error' ? 7000 : 4000}
          onClose={() => dismissToast(t.id)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          sx={{ bottom: { xs: 16 + i * 64, sm: 24 + i * 64 } }}
        >
          <Alert
            severity={t.severity}
            variant="filled"
            onClose={() => dismissToast(t.id)}
            action={
              <IconButton
                size="small"
                color="inherit"
                onClick={() => dismissToast(t.id)}
                aria-label="Dismiss"
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            }
            sx={{ minWidth: 280 }}
          >
            {t.message}
          </Alert>
        </Snackbar>
      ))}
    </Ctx.Provider>
  );
}

export function useData(): DataState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData must be used within <DataProvider>');
  return v;
}

// ----------------- selector hooks (cached bootstrap data) -----------------
// These are trivial selectors over the central context; keeping them co-located
// with the Provider avoids fragmenting one-liners into many tiny files.

export const useEntities = (): Entity[] => useData().entities;
export const useFlows = (): TransactionFlow[] => useData().flows;
export const useRoyalties = (): Royalty[] => useData().royalties;
export const useInvoices = (): Invoice[] => useData().invoices;
export const useMarginTrend = (): MonthlyMarginRow[] => useData().marginTrend;
export const useKpis = (): KpiSummary => useData().kpis;
export const useSettings = (): AppSettings => useData().settings;
export const useRefetch = () => useData().refetch;
export const useRefreshing = (): boolean => useData().refreshing;
export const useLastFetchedAt = (): Date => useData().lastFetchedAt;
export const useToast = (): ToastApi => useData().toast;
export const usePeriod = (): PeriodSelection => useData().period;
export const useSetPeriod = () => useData().setPeriod;
export const useSetYear = () => useData().setYear;
export const useAvailableYears = (): number[] => useData().availableYears;

/** Look up a single entity by id from the cached list. */
export function useEntity(id: string | undefined): Entity | undefined {
  const entities = useEntities();
  return useMemo(() => entities.find((e) => e.id === id), [entities, id]);
}
