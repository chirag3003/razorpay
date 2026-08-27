"use client";

import { useEffect, useRef, useState } from "react";
import { useAdminAuthStore, handleAdminApiError } from "@/store/admin-auth-store";
import type { Paginated } from "@/lib/admin-types";

type AdminListResult<T> = {
  items: T[];
  total: number;
  loading: boolean;
  failed: boolean;
  /** Splice a mutated row in place without a round trip. */
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
  /** Re-run the fetch (retry after an error, or refetch after a mutation). */
  reload: () => void;
};

/**
 * The one place the admin list-fetching dance lives: token wiring, an `ignore`
 * cancellation flag, a reloadKey counter for retries, and the 401 funnel.
 *
 * `filters` is compared by value (JSON), so call sites can pass a fresh object
 * literal each render without needing useMemo discipline.
 */
export function useAdminList<T, F>(
  fetcher: (token: string, filters: F) => Promise<Paginated<T>>,
  filters: F
): AdminListResult<T> {
  const token = useAdminAuthStore((state) => state.token);
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Held in a ref so a re-created closure can't retrigger the effect. Assigned in
  // an effect rather than during render; this one is declared first, so it has
  // already refreshed the ref by the time the fetch effect below runs.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    if (!token) return;
    let ignore = false;

    setLoading(true);
    setFailed(false);

    fetcherRef
      .current(token, JSON.parse(filtersKey) as F)
      .then((page) => {
        if (ignore) return;
        setItems(page.items);
        setTotal(page.total);
      })
      .catch((err) => {
        if (ignore) return;
        handleAdminApiError(err);
        setFailed(true);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [token, filtersKey, reloadKey]);

  return {
    items,
    total,
    loading,
    failed,
    setItems,
    reload: () => setReloadKey((key) => key + 1),
  };
}
