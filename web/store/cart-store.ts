import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CartItem } from "@/lib/types";
import { getProductById } from "@/lib/queries";

type CartState = {
  items: CartItem[];
  addItem: (productId: string, qty?: number) => void;
  removeItem: (productId: string) => void;
  updateQty: (productId: string, qty: number) => void;
  clear: () => void;
};

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      addItem: (productId, qty = 1) =>
        set((state) => {
          const existing = state.items.find(
            (item) => item.productId === productId
          );
          if (existing) {
            return {
              items: state.items.map((item) =>
                item.productId === productId
                  ? { ...item, qty: item.qty + qty }
                  : item
              ),
            };
          }
          return { items: [...state.items, { productId, qty }] };
        }),
      removeItem: (productId) =>
        set((state) => ({
          items: state.items.filter((item) => item.productId !== productId),
        })),
      updateQty: (productId, qty) =>
        set((state) => {
          if (qty <= 0) {
            return {
              items: state.items.filter((item) => item.productId !== productId),
            };
          }
          return {
            items: state.items.map((item) =>
              item.productId === productId ? { ...item, qty } : item
            ),
          };
        }),
      clear: () => set({ items: [] }),
    }),
    { name: "freshcart-cart" }
  )
);

export function useCartLines() {
  const items = useCartStore((state) => state.items);
  return items
    .map((item) => {
      const product = getProductById(item.productId);
      if (!product) return null;
      return { product, qty: item.qty };
    })
    .filter((line): line is { product: NonNullable<typeof line>["product"]; qty: number } => line !== null);
}

export function useCartSummary() {
  const lines = useCartLines();
  const itemCount = lines.reduce((sum, line) => sum + line.qty, 0);
  const subtotal = lines.reduce(
    (sum, line) => sum + line.product.price * line.qty,
    0
  );
  return { itemCount, subtotal, lines };
}
