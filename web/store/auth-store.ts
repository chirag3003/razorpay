import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";
import * as authApi from "@/lib/api/auth";
import { useCartStore } from "@/store/cart-store";
import type { User } from "@/lib/types";

type AuthStatus =
  | "idle"
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "error";

type AuthState = {
  user: User | null;
  token: string | null;
  status: AuthStatus;
  /**
   * Set only when a 401 tore the session down mid-session, so the UI can tell
   * "your login lapsed, here's the way back" apart from a deliberate logout.
   * Transient — deliberately outside `partialize`, and cleared by whoever acts
   * on it (see components/auth/auth-hydrator.tsx).
   */
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: {
    name: string;
    email: string;
    phone: string;
    password: string;
  }) => Promise<void>;
  logout: () => void;
  expireSession: () => void;
  clearSessionExpired: () => void;
  setUser: (user: User) => void;
  hydrateFromServer: () => Promise<void>;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      status: "idle",
      sessionExpired: false,

      login: async (email, password) => {
        const { user, token } = await authApi.login({ email, password });
        set({ user, token, status: "authenticated", sessionExpired: false });
        useCartStore.getState().fetchCart();
      },

      signup: async (data) => {
        const { user, token } = await authApi.signup(data);
        set({ user, token, status: "authenticated", sessionExpired: false });
        useCartStore.getState().fetchCart();
      },

      logout: () => {
        set({
          user: null,
          token: null,
          status: "unauthenticated",
          sessionExpired: false,
        });
        useCartStore.getState().reset();
      },

      // Same teardown as `logout`, but flagged so the UI can redirect the user
      // somewhere useful instead of leaving them on a page that will now fail
      // every action. See handleAuthApiError below.
      expireSession: () => {
        set({
          user: null,
          token: null,
          status: "unauthenticated",
          sessionExpired: true,
        });
        useCartStore.getState().reset();
      },

      clearSessionExpired: () => set({ sessionExpired: false }),

      // Write back a user the server has just returned (e.g. PATCH /api/auth/me).
      // The account form is driven by `useForm({ values: user })`, so without
      // this react-hook-form resets the fields to the stale store values on the
      // next render and a saved edit looks discarded.
      setUser: (user) => set({ user }),

      hydrateFromServer: async () => {
        const token = get().token;
        if (!token) {
          set({ status: "unauthenticated" });
          return;
        }
        set({ status: "loading" });
        try {
          const { user } = await authApi.getMe(token);
          set({ user, status: "authenticated", sessionExpired: false });
          useCartStore.getState().fetchCart();
        } catch (err) {
          if (isUnauthorizedError(err)) {
            // Token is genuinely invalid — clear the session.
            set({
              user: null,
              token: null,
              status: "unauthenticated",
              sessionExpired: false,
            });
          } else {
            // Network / server error — keep the session so the user isn't
            // logged out by a transient backend outage; let the UI offer a retry.
            set({ status: "error" });
          }
        }
      },
    }),
    {
      name: "freshcart-auth",
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);

/**
 * Funnel every *shopper* API failure through this, the way the admin surface
 * funnels its own through `handleAdminApiError`. A 401 means the 7-day JWT
 * lapsed or was revoked — the session is over, so tear it down once, here,
 * rather than letting each call site render its own dead-end toast.
 *
 * Anything else (network, 5xx) returns false and stays retryable, with the
 * token kept: a backend restart must not log everyone out.
 *
 * Returns true when the error was an expired/invalid session, in which case the
 * caller should return early — its own error UI is moot.
 */
export function handleAuthApiError(err: unknown): boolean {
  if (isUnauthorizedError(err)) {
    useAuthStore.getState().expireSession();
    toast.error("Your session expired. Please log in again.");
    return true;
  }
  return false;
}

export function isUnauthorizedError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "UNAUTHORIZED"
  );
}
