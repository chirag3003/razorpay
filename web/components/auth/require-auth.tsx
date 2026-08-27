"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ErrorState } from "@/components/common/error-state";
import { useAuthStore } from "@/store/auth-store";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, pathname, router]);

  if (status === "authenticated") {
    return <>{children}</>;
  }

  if (status === "error") {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center px-4 py-10">
        <ErrorState
          title="We couldn't verify your session"
          description="We couldn't reach the server. Your session is still saved — try again in a moment."
          onRetry={() => useAuthStore.getState().hydrateFromServer()}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
