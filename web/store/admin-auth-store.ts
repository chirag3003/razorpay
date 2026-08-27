import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";
import * as adminApi from "@/lib/api/admin";
import { isUnauthorizedError } from "@/store/auth-store";

type AdminAuthStatus =
  | "idle"
  | "loading"
  | "authenticated"
  | "unauthenticated";

type AdminAuthState = {
  token: string | null;
  status: AdminAuthStatus;
  login: (password: string) => Promise<void>;
  logout: () => void;
  hydrate: () => void;
};

/**
 * The admin session is deliberately separate from the shopper session
 * (`freshcart-auth`): a different signing secret, a 12h TTL, and tokens that are
 * not interchangeable in either direction. Both can be present in one browser.
 */
export const useAdminAuthStore = create<AdminAuthState>()(
  persist(
    (set, get) => ({
      token: null,
      status: "idle",

      login: async (password) => {
        const { token } = await adminApi.adminLogin(password);
        set({ token, status: "authenticated" });
      },

      logout: () => set({ token: null, status: "unauthenticated" }),

      // Purely local. The backend exposes no `GET /api/admin/me`, so there is
      // nothing to validate a stored token against without burning a request on
      // a real endpoint. Instead we trust a persisted token optimistically and
      // let the first 401 from any admin call tear the session down — see
      // handleAdminApiError in lib/admin-error.ts.
      hydrate: () =>
        set({ status: get().token ? "authenticated" : "unauthenticated" }),
    }),
    {
      name: "freshcart-admin-auth",
      partialize: (state) => ({ token: state.token }),
    }
  )
);

/**
 * Funnel every admin API failure through this. A 401 means the shared password
 * changed or the 12h token lapsed — either way the session is over. Anything
 * else (network, 5xx) is left for the calling page to render as a retryable
 * error, with the token kept so a transient outage doesn't force a re-login.
 *
 * Returns true when the error was an expired/invalid session.
 */
export function handleAdminApiError(err: unknown): boolean {
  if (isUnauthorizedError(err)) {
    useAdminAuthStore.getState().logout();
    toast.error("Your admin session expired. Please sign in again.");
    return true;
  }
  return false;
}
