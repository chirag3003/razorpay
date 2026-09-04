"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

/** What one settled fetch produced, tagged with the request it answered. */
type Settled<T> = {
  key: string;
  items: T[];
  total: number;
  failed: boolean;
};

/**
 * The one place the admin list-fetching dance lives: token wiring, an `ignore`
 * cancellation flag, a reloadKey counter for retries, and the 401 funnel.
 *
 * `filters` is compared by value (JSON), so call sites can pass a fresh object
 * literal each render without needing useMemo discipline.
 *
 * `loading` is *derived* — "the settled result doesn't answer the request we'd
 * make right now" — rather than set at the top of the effect. Setting it there
 * meant a synchronous setState inside the effect body, which cost an extra
 * render on every admin list fetch before the request had even gone out.
 */
export function useAdminList<T, F>(
  fetcher: (token: string, filters: F) => Promise<Paginated<T>>,
  filters: F
): AdminListResult<T> {
  const token = useAdminAuthStore((state) => state.token);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Held in a ref so a re-created closure can't retrigger the effect. Assigned in
  // an effect rather than during render; this one is declared first, so it has
  // already refreshed the ref by the time the fetch effect below runs.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const filtersKey = JSON.stringify(filters);
  const requestKey = `${token}|${filtersKey}|${reloadKey}`;

  useEffect(() => {
    if (!token) return;
    let ignore = false;

    fetcherRef
      .current(token, JSON.parse(filtersKey) as F)
      .then((page) => {
        if (ignore) return;
        setSettled({
          key: requestKey,
          items: page.items,
          total: page.total,
          failed: false,
        });
      })
      .catch((err) => {
        if (ignore) return;
        handleAdminApiError(err);
        setSettled({ key: requestKey, items: [], total: 0, failed: true });
      });

    return () => {
      ignore = true;
    };
  }, [token, filtersKey, requestKey]);

  // Keeps the `Dispatch<SetStateAction<T[]>>` shape call sites already use to
  // splice a mutated row, now that the rows live inside one state object.
  const setItems = useCallback<React.Dispatch<React.SetStateAction<T[]>>>(
    (action) => {
      setSettled((prev) =>
        prev
          ? {
              ...prev,
              items:
                typeof action === "function"
                  ? (action as (rows: T[]) => T[])(prev.items)
                  : action,
            }
          : prev
      );
    },
    []
  );

  return {
    items: settled?.items ?? [],
    total: settled?.total ?? 0,
    loading: settled?.key !== requestKey,
    failed: settled?.failed ?? false,
    setItems,
    reload: () => setReloadKey((key) => key + 1),
  };
}
