import { create } from "zustand";
import * as cartApi from "@/lib/api/cart";
import { useAuthStore } from "@/store/auth-store";
import type { Cart } from "@/lib/types";

type CartState = {
  cart: Cart | null;
  status: "idle" | "loading" | "ready" | "error";
  fetchCart: () => Promise<void>;
  addItem: (productId: string, qty?: number) => Promise<void>;
  updateQty: (itemId: string, qty: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  clear: () => Promise<void>;
  reset: () => void;
};

function requireToken(): string {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error("Not authenticated");
  return token;
}

export const useCartStore = create<CartState>()((set) => ({
  cart: null,
  status: "idle",

  fetchCart: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    set({ status: "loading" });
    try {
      const cart = await cartApi.fetchCart(token);
      set({ cart, status: "ready" });
    } catch {
      set({ status: "error" });
    }
  },

  addItem: async (productId, qty = 1) => {
    const cart = await cartApi.addItem(requireToken(), productId, qty);
    set({ cart, status: "ready" });
  },

  updateQty: async (itemId, qty) => {
    const cart = await cartApi.updateQty(requireToken(), itemId, qty);
    set({ cart, status: "ready" });
  },

  removeItem: async (itemId) => {
    const cart = await cartApi.removeItem(requireToken(), itemId);
    set({ cart, status: "ready" });
  },

  clear: async () => {
    const cart = await cartApi.clearCart(requireToken());
    set({ cart, status: "ready" });
  },

  reset: () => set({ cart: null, status: "idle" }),
}));

export function useCartLines() {
  return useCartStore((state) => state.cart?.items ?? []);
}

export function useCartSummary() {
  const cart = useCartStore((state) => state.cart);
  return {
    lines: cart?.items ?? [],
    itemCount: cart?.itemCount ?? 0,
    subtotal: cart?.subtotal ?? 0,
    deliveryFee: cart?.deliveryFee ?? 0,
    total: cart?.total ?? 0,
  };
}
