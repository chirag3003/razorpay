"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Safe here despite the codebase being CSS-only elsewhere: the chat panel is
 * closed at hydration, so by the time it mounts `matchMedia` has long resolved
 * and there is nothing to flicker. The launcher button stays pure-CSS.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query]
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  }, [query]);

  // Mobile-first: assume the small layout on the server.
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
