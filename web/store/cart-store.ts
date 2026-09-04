import { create } from "zustand";
import * as cartApi from "@/lib/api/cart";
import { useAuthStore, handleAuthApiError } from "@/store/auth-store";
import type { Cart, CartLine } from "@/lib/types";

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

/**
 * Every cart write takes the next number here, and a response is applied only if
 * its number is still the highest one seen. Tapping `+` five times fires five
 * concurrent PATCHes whose responses can land out of order; without this the
 * displayed quantity settles on whichever *responded* last rather than whichever
 * was *issued* last, and stays wrong until the next fetch.
 */
let requestSeq = 0;
let lastAppliedSeq = 0;

function applyServerCart(
  set: (partial: Partial<CartState>) => void,
  seq: number,
  cart: Cart
) {
  if (seq < lastAppliedSeq) return;
  lastAppliedSeq = seq;
  set({ cart, status: "ready" });
}

/**
 * Recompute the totals a line change implies, so the number under the user's
 * thumb moves immediately instead of after a round trip.
 *
 * `deliveryFee` is a backend rule (it depends on a subtotal threshold we
 * deliberately don't duplicate here), so it is carried over unchanged and the
 * server's response corrects it a moment later.
 */
function withLines(cart: Cart, items: CartLine[]): Cart {
  const subtotal = items.reduce(
    (sum, line) => sum + line.product.price * line.qty,
    0
  );
  return {
    ...cart,
    items,
    itemCount: items.reduce((sum, line) => sum + line.qty, 0),
    subtotal,
    total: subtotal + cart.deliveryFee,
  };
}

export const useCartStore = create<CartState>()((set, get) => {
  /**
   * Pull the authoritative cart after a failed write. Takes a fresh sequence
   * number so it outranks any mutation still in flight, and leaves `status`
   * alone — the cart page renders a spinner on "loading", and a background
   * correction shouldn't blank the page the user is looking at.
   */
  async function resync() {
    const token = useAuthStore.getState().token;
    if (!token) return;
    const seq = ++requestSeq;
    try {
      applyServerCart(set, seq, await cartApi.fetchCart(token));
    } catch {
      // Nothing useful left to do — the optimistic value stands until the next
      // successful call. The write's own error is what the caller reports.
    }
  }

  /** Optimistic write, then reconcile with whatever the server returns. */
  async function mutate(
    optimistic: (cart: Cart) => Cart,
    request: (token: string) => Promise<Cart>
  ) {
    const token = requireToken();
    const seq = ++requestSeq;

    const current = get().cart;
    if (current) {
      lastAppliedSeq = seq;
      set({ cart: optimistic(current), status: "ready" });
    }

    try {
      applyServerCart(set, seq, await request(token));
    } catch (err) {
      // Roll the optimistic write back to the server's truth rather than to a
      // snapshot: with several taps in flight, a snapshot would also undo the
      // ones that succeeded.
      await resync();
      throw err;
    }
  }

  return {
    cart: null,
    status: "idle",

    fetchCart: async () => {
      const token = useAuthStore.getState().token;
      if (!token) return;
      const seq = ++requestSeq;
      set({ status: "loading" });
      try {
        applyServerCart(set, seq, await cartApi.fetchCart(token));
      } catch (err) {
        // A 401 ends the session outright; anything else stays retryable.
        if (handleAuthApiError(err)) return;
        set({ status: "error" });
      }
    },

    addItem: async (productId, qty = 1) => {
      await mutate(
        (cart) => {
          const line = cart.items.find((i) => i.product.id === productId);
          // A product not already in the cart has no line to bump — we hold only
          // its id here, not the price and name a line needs. Those adds wait for
          // the response; the "Add" button already shows a pending state.
          if (!line) return cart;
          return withLines(
            cart,
            cart.items.map((i) =>
              i.itemId === line.itemId ? { ...i, qty: i.qty + qty } : i
            )
          );
        },
        (token) => cartApi.addItem(token, productId, qty)
      );
    },

    updateQty: async (itemId, qty) => {
      await mutate(
        (cart) =>
          withLines(
            cart,
            qty <= 0
              ? cart.items.filter((i) => i.itemId !== itemId)
              : cart.items.map((i) => (i.itemId === itemId ? { ...i, qty } : i))
          ),
        (token) => cartApi.updateQty(token, itemId, qty)
      );
    },

    removeItem: async (itemId) => {
      await mutate(
        (cart) =>
          withLines(
            cart,
            cart.items.filter((i) => i.itemId !== itemId)
          ),
        (token) => cartApi.removeItem(token, itemId)
      );
    },

    clear: async () => {
      await mutate(
        (cart) => withLines(cart, []),
        (token) => cartApi.clearCart(token)
      );
    },

    reset: () => {
      // Bump past every in-flight response so a request issued for the previous
      // user can't repopulate the cart after logout.
      lastAppliedSeq = ++requestSeq;
      set({ cart: null, status: "idle" });
    },
  };
});

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
