import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Product } from "@/lib/types";

type WishlistState = {
  products: Product[];
  toggle: (product: Product) => void;
  has: (productId: string) => boolean;
  clear: () => void;
};

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      products: [],
      toggle: (product) =>
        set((state) => ({
          products: state.products.some((p) => p.id === product.id)
            ? state.products.filter((p) => p.id !== product.id)
            : [...state.products, product],
        })),
      has: (productId) => get().products.some((p) => p.id === productId),
      clear: () => set({ products: [] }),
    }),
    { name: "freshcart-wishlist" }
  )
);

export function useWishlistProducts() {
  return useWishlistStore((state) => state.products);
}
