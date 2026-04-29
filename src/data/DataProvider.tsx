/**
 * DataProvider — central read/write context for the React app.
 *
 * Responsibilities:
 *  - Bootstrap fetch (entities, flows, royalties, invoices, marginTrend, kpis,
 *    settings) on mount, and re-fetch whenever the global PeriodFilter changes.
 *  - Loading / error / refreshing UI gates.
 *  - Toast queue (any hook can call `toast.show("…", "error")`).
 *  - Lazy on-demand hooks for per-page reads (entityFlows, journalEntries,
 *    berryTrend) and write mutations (submitAdjustment, savePolicyOverride,
 *    saveSettings).
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
import { api } from './api';
import type {
  Entity,
  TransactionFlow,
  Invoice,
  Royalty,
  MonthlyMarginRow,
  KpiSummary,
  EntityFlow,
  BerryRow,
  JournalEntryRow,
  PeriodParams,
  SubmittedAdjustment,
  PolicyOverride,
  AppSettings,
} from './api';

// ----------------- types -----------------

export type ToastSeverity = 'success' | 'info' | 'warning' | 'error';

interface ToastApi {
  show: (message: string, severity?: ToastSeverity) => void;
}

/** Quarterly preset used by the AppShell period select. */
export type PeriodKey = 'q1' | 'q2' | 'q3' | 'q4' | 'fy';

export interface PeriodSelection {
  key: PeriodKey;
  year: number;
  periodFrom: string;
  periodTo: string;
}

const PERIOD_PRESETS: Record<PeriodKey, { from: string; to: string; label: string }> = {
  q1: { from: '001', to: '003', label: 'Q1 (Jan–Mar)' },
  q2: { from: '004', to: '006', label: 'Q2 (Apr–Jun)' },
  q3: { from: '007', to: '009', label: 'Q3 (Jul–Sep)' },
  q4: { from: '010', to: '012', label: 'Q4 (Oct–Dec)' },
  fy: { from: '001', to: '012', label: 'Full Year' },
};

export function buildPeriod(key: PeriodKey, year: number): PeriodSelection {
  const p = PERIOD_PRESETS[key];
  return { key, year, periodFrom: p.from, periodTo: p.to };
}

export function periodLabel(key: PeriodKey): string {
  return PERIOD_PRESETS[key].label;
}

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

// ----------------- provider -----------------

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
    []
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
    [showToast]
  );

  const refetch = useCallback(() => load(true, period), [load, period]);

  /** Switch the global period filter; triggers a fresh bootstrap fetch. */
  const setPeriod = useCallback(
    (key: PeriodKey) => {
      const next = buildPeriod(key, period.year);
      setPeriodState(next);
      void load(true, next);
    },
    [load, period.year]
  );

  /** Switch the active fiscal year; preserves the current quarter selection. */
  const setYear = useCallback(
    (year: number) => {
      const next = buildPeriod(period.key, year);
      setPeriodState(next);
      void load(true, next);
    },
    [load, period.key]
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

function useData(): DataState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData must be used within <DataProvider>');
  return v;
}

// ----------------- public hooks (cached bootstrap) -----------------

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

// ----------------- on-demand hooks (lazy fetch per call site) -----------------

interface AsyncResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

function useAsync<T>(
  fetcher: (() => Promise<T>) | null,
  keys: ReadonlyArray<unknown>,
  toastLabel: string,
  toast: ToastApi
): AsyncResult<T> {
  const [state, setState] = useState<AsyncResult<T>>({
    data: null,
    loading: !!fetcher,
    error: null,
  });
  useEffect(() => {
    if (!fetcher) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setState({ data: null, loading: false, error: err });
        toast.show(`${toastLabel} failed: ${err.message}`, 'error');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, keys);
  return state;
}

/** Fetch the per-entity flow breakdown lazily, when EntityDetail mounts. */
export function useEntityFlows(entityId: string | undefined): AsyncResult<EntityFlow[]> {
  const toast = useToast();
  const period = usePeriod();
  return useAsync<EntityFlow[]>(
    entityId
      ? () =>
          api.entityFlows(entityId, {
            year: period.year,
            periodFrom: period.periodFrom,
            periodTo: period.periodTo,
          })
      : null,
    [entityId, period.year, period.periodFrom, period.periodTo],
    'Loading flow breakdown',
    toast
  );
}

/** Fetch ACDOCA journal-entry lines for the entity (drill-down). */
export function useJournalEntries(params: {
  entity?: string;
  period?: string;
  year?: number;
  limit?: number;
}): AsyncResult<JournalEntryRow[]> {
  const { entity, period, year, limit } = params;
  const toast = useToast();
  return useAsync<JournalEntryRow[]>(
    entity ? () => api.journalEntries({ entity, period, year, limit }) : null,
    [entity, period, year, limit],
    'Loading journal entries',
    toast
  );
}

/** Fetch monthly Berry-ratio trend, with optional entity filter. */
export function useBerryTrend(
  params: { entity?: string; target?: number } = {}
): AsyncResult<BerryRow[]> {
  const { entity, target } = params;
  const toast = useToast();
  const period = usePeriod();
  return useAsync<BerryRow[]>(
    () =>
      api.berryTrend({
        entity,
        target,
        year: period.year,
        periodFrom: period.periodFrom,
        periodTo: period.periodTo,
      }),
    [entity, target, period.year, period.periodFrom, period.periodTo],
    'Loading Berry-ratio trend',
    toast
  );
}

/** Fetch the list of submitted adjustments from the write store. */
export function useSubmittedAdjustments(): AsyncResult<SubmittedAdjustment[]> & {
  reload: () => void;
} {
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const result = useAsync<SubmittedAdjustment[]>(
    () => api.submittedAdjustments(),
    [tick],
    'Loading submitted adjustments',
    toast
  );
  return { ...result, reload: () => setTick((n) => n + 1) };
}

// ----------------- mutation hooks -----------------

interface MutationResult {
  pending: boolean;
  error: Error | null;
}

/** Submit a new adjustment to the backend store; refresh dashboard data on success. */
export function useSubmitAdjustment(): {
  submit: (
    body: Omit<SubmittedAdjustment, 'id' | 'submittedAt' | 'status'>
  ) => Promise<SubmittedAdjustment | null>;
} & MutationResult {
  const toast = useToast();
  const refetch = useRefetch();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const submit = useCallback(
    async (body: Omit<SubmittedAdjustment, 'id' | 'submittedAt' | 'status'>) => {
      setPending(true);
      setError(null);
      try {
        const adj = await api.submitAdjustment(body);
        toast.show(`Adjustment ${adj.id} submitted for approval`, 'success');
        // Surface the new record in invoices etc.
        await refetch();
        return adj;
      } catch (e) {
        const err = e as Error;
        setError(err);
        toast.show(`Submit failed: ${err.message}`, 'error');
        return null;
      } finally {
        setPending(false);
      }
    },
    [toast, refetch]
  );
  return { submit, pending, error };
}

/** Save (upsert) a policy override for a flow row. */
export function useSavePolicyOverride(): {
  save: (
    flowId: string,
    body: Omit<PolicyOverride, 'flowId' | 'updatedAt'>
  ) => Promise<PolicyOverride | null>;
} & MutationResult {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const save = useCallback(
    async (flowId: string, body: Omit<PolicyOverride, 'flowId' | 'updatedAt'>) => {
      setPending(true);
      setError(null);
      try {
        const o = await api.savePolicyOverride(flowId, body);
        toast.show(`Policy override saved for ${flowId}`, 'success');
        return o;
      } catch (e) {
        const err = e as Error;
        setError(err);
        toast.show(`Save failed: ${err.message}`, 'error');
        return null;
      } finally {
        setPending(false);
      }
    },
    [toast]
  );
  return { save, pending, error };
}

/** Lifecycle actions on submitted adjustments — approve / reject / export / reverse / delete.
 *  Each method refreshes the bootstrap data so the new state lands in /api/invoices. */
export function useAdjustmentLifecycle(): {
  approve: (id: string, by: string) => Promise<boolean>;
  reject: (id: string, by: string, reason: string) => Promise<boolean>;
  markExported: (id: string, ref?: string) => Promise<boolean>;
  reverse: (id: string, by: string) => Promise<SubmittedAdjustment | null>;
  remove: (id: string) => Promise<boolean>;
} & MutationResult {
  const toast = useToast();
  const refetch = useRefetch();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const wrap = async <T,>(
    label: string,
    fn: () => Promise<T>
  ): Promise<T | null> => {
    setPending(true);
    setError(null);
    try {
      const result = await fn();
      await refetch();
      return result;
    } catch (e) {
      const err = e as Error;
      setError(err);
      toast.show(`${label} failed: ${err.message}`, 'error');
      return null;
    } finally {
      setPending(false);
    }
  };

  const approve = useCallback(
    async (id: string, by: string) => {
      const r = await wrap('Approve', () =>
        api.patchAdjustment(id, { status: 'Approved', approvedBy: by, by })
      );
      if (r) toast.show(`${id} approved`, 'success');
      return !!r;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const reject = useCallback(
    async (id: string, by: string, reason: string) => {
      const r = await wrap('Reject', () =>
        api.patchAdjustment(id, {
          status: 'Rejected',
          rejectionReason: reason,
          by,
        })
      );
      if (r) toast.show(`${id} rejected`, 'info');
      return !!r;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const markExported = useCallback(
    async (id: string, ref?: string) => {
      const r = await wrap('Mark exported', () =>
        api.patchAdjustment(id, { status: 'Exported', exportedRef: ref })
      );
      if (r) toast.show(`${id} marked exported`, 'success');
      return !!r;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const reverse = useCallback(
    async (id: string, by: string) => {
      const counter = await wrap('Reverse', () => api.reverseAdjustment(id, { by }));
      if (counter)
        toast.show(`${id} reversed — counter ${counter.id} created`, 'success');
      return counter;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const remove = useCallback(
    async (id: string) => {
      const r = await wrap('Delete', () => api.deleteAdjustment(id));
      if (r) toast.show(`${id} deleted`, 'success');
      return !!r;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return { approve, reject, markExported, reverse, remove, pending, error };
}

/** Save app-wide settings; refreshes the cached settings on success. */
export function useSaveSettings(): {
  save: (body: AppSettings) => Promise<AppSettings | null>;
} & MutationResult {
  const toast = useToast();
  const refetch = useRefetch();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const save = useCallback(
    async (body: AppSettings) => {
      setPending(true);
      setError(null);
      try {
        const s = await api.saveSettings(body);
        toast.show('Settings saved', 'success');
        await refetch();
        return s;
      } catch (e) {
        const err = e as Error;
        setError(err);
        toast.show(`Save failed: ${err.message}`, 'error');
        return null;
      } finally {
        setPending(false);
      }
    },
    [toast, refetch]
  );
  return { save, pending, error };
}
