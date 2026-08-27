import { create } from "zustand";
import * as adminApi from "@/lib/api/admin";
import type { CategoryWithCount } from "@/lib/admin-types";

type AdminCategoriesState = {
  categories: CategoryWithCount[];
  status: "idle" | "loading" | "ready" | "error";
  fetchCategories: (token: string) => Promise<void>;
  /** Force the next fetchCategories to hit the network again. */
  invalidate: () => void;
};

/**
 * `GET /api/admin/categories` is unpaginated and cheap, and three surfaces need
 * it (the categories page, the products filter, and the product form's category
 * select) — so it's cached here rather than refetched per page.
 */
export const useAdminCategoriesStore = create<AdminCategoriesState>()(
  (set, get) => ({
    categories: [],
    status: "idle",

    fetchCategories: async (token) => {
      const { status } = get();
      if (status === "loading" || status === "ready") return;
      set({ status: "loading" });
      try {
        const categories = await adminApi.getAdminCategories(token);
        set({ categories, status: "ready" });
      } catch {
        set({ status: "error" });
      }
    },

    invalidate: () => set({ status: "idle" }),
  })
);
