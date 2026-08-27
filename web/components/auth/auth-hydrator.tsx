"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/store/auth-store";
import { useCategoriesStore } from "@/store/categories-store";

export function AuthHydrator() {
  useEffect(() => {
    useAuthStore.getState().hydrateFromServer();
    useCategoriesStore.getState().fetchCategories();
  }, []);

  return null;
}
