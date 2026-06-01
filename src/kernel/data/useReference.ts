import { useEffect, useState } from 'react';
import { api } from '@/shared/api/client';

/** Fetch a read-only reference seed set (benchmarks, dempe, pillar_two, …). */
export function useReference<T = unknown>(name: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .reference<T>(name)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [name]);
  return { data, loading };
}
