"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAdminAuthStore } from "@/store/admin-auth-store";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const status = useAdminAuthStore((state) => state.status);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, pathname, router]);

  if (status === "authenticated") {
    return <>{children}</>;
  }

  // There's no header or footer here to sit between, so the waiting state fills
  // the viewport rather than a slice of it.
  return (
    <div className="flex min-h-svh flex-1 items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
