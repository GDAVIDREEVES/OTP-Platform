import { useEffect, useState } from 'react';
import { api } from '@/shared/api/client';
import type { ProcessCatalog, ProcessDef } from './types';
import { FALLBACK_CATALOG } from './fallback';

// Module-level cache so the catalog is fetched once per session.
let cache: ProcessCatalog | null = null;
let inflight: Promise<ProcessCatalog> | null = null;

function load(): Promise<ProcessCatalog> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api
      .processes()
      .then((c) => {
        cache = c;
        return c;
      })
      .catch((e) => {
        inflight = null; // allow a retry on the next mount
        throw e;
      });
  }
  return inflight;
}

export interface UseProcesses {
  catalog: ProcessCatalog | null;
  loading: boolean;
  error: string | null;
}

export function useProcesses(): UseProcesses {
  const [catalog, setCatalog] = useState<ProcessCatalog | null>(cache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cache) return;
    let alive = true;
    load()
      .then((c) => alive && setCatalog(c))
      .catch((e) => {
        if (!alive) return;
        setError(String(e));
        setCatalog(FALLBACK_CATALOG); // graceful degradation
      });
    return () => {
      alive = false;
    };
  }, []);

  return { catalog, loading: catalog == null && error == null, error };
}

export function useProcess(id: string | undefined): {
  def: ProcessDef | null;
  loading: boolean;
} {
  const { catalog, loading } = useProcesses();
  const def =
    id && catalog
      ? catalog.processes.find((p) => p.id.toLowerCase() === id.toLowerCase()) ?? null
      : null;
  return { def, loading };
}
