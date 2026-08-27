"use client";

import { useEffect } from "react";
import { useAdminAuthStore } from "@/store/admin-auth-store";

/**
 * Flips the admin session out of "idle" once on mount. Mirrors
 * components/auth/auth-hydrator.tsx — the store starts "idle" on both server and
 * client (status isn't persisted), which is what keeps the guard from
 * hydration-mismatching on a persisted token.
 */
export function AdminHydrator() {
  useEffect(() => {
    useAdminAuthStore.getState().hydrate();
  }, []);

  return null;
}
