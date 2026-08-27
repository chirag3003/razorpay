import { create } from "zustand";
import { persist } from "zustand/middleware";
import * as authApi from "@/lib/api/auth";
import { useCartStore } from "@/store/cart-store";
import type { User } from "@/lib/types";

type AuthStatus = "idle" | "loading" | "authenticated" | "unauthenticated";

type AuthState = {
  user: User | null;
  token: string | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: {
    name: string;
    email: string;
    phone: string;
    password: string;
  }) => Promise<void>;
  logout: () => void;
  hydrateFromServer: () => Promise<void>;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      status: "idle",

      login: async (email, password) => {
        const { user, token } = await authApi.login({ email, password });
        set({ user, token, status: "authenticated" });
        useCartStore.getState().fetchCart();
      },

      signup: async (data) => {
        const { user, token } = await authApi.signup(data);
        set({ user, token, status: "authenticated" });
        useCartStore.getState().fetchCart();
      },

      logout: () => {
        set({ user: null, token: null, status: "unauthenticated" });
        useCartStore.getState().reset();
      },

      hydrateFromServer: async () => {
        const token = get().token;
        if (!token) {
          set({ status: "unauthenticated" });
          return;
        }
        set({ status: "loading" });
        try {
          const { user } = await authApi.getMe(token);
          set({ user, status: "authenticated" });
          useCartStore.getState().fetchCart();
        } catch {
          set({ user: null, token: null, status: "unauthenticated" });
        }
      },
    }),
    {
      name: "freshcart-auth",
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);

export function isUnauthorizedError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "UNAUTHORIZED"
  );
}
