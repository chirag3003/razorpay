"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { useCategoriesStore } from "@/store/categories-store";

export function AuthHydrator() {
  const router = useRouter();
  const pathname = usePathname();
  const sessionExpired = useAuthStore((state) => state.sessionExpired);

  useEffect(() => {
    useAuthStore.getState().hydrateFromServer();
    useCategoriesStore.getState().fetchCategories();
  }, []);

  // The one place a lapsed shopper session turns into a way out. `handleAuthApiError`
  // raises the flag from anywhere (a store, a plain callback, a page far from any
  // route guard); the redirect happens here so it needs a router only once.
  //
  // Deliberate logouts don't set the flag, so they keep their own destination.
  // /admin is skipped outright: it runs a separate session and /login is the wrong
  // door for it.
  useEffect(() => {
    if (!sessionExpired) return;
    useAuthStore.getState().clearSessionExpired();
    if (pathname.startsWith("/admin") || pathname.startsWith("/login")) return;
    router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [sessionExpired, pathname, router]);

  return null;
}
