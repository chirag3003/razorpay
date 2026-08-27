import { create } from "zustand";
import { getCategories } from "@/lib/api/catalog";
import type { Category } from "@/lib/types";

type CategoriesState = {
  categories: Category[];
  status: "idle" | "loading" | "ready" | "error";
  fetchCategories: () => Promise<void>;
};

export const useCategoriesStore = create<CategoriesState>()((set, get) => ({
  categories: [],
  status: "idle",

  fetchCategories: async () => {
    if (get().status === "loading" || get().status === "ready") return;
    set({ status: "loading" });
    try {
      const categories = await getCategories();
      set({ categories, status: "ready" });
    } catch {
      set({ status: "error" });
    }
  },
}));
