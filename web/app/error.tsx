"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/common/error-state";

export default function Error({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  // `retry` is the stable prop in this Next.js; `reset` is kept as a fallback.
  retry?: () => void;
  reset?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const recover = retry ?? reset ?? (() => window.location.reload());

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center px-4 py-10">
      <ErrorState onRetry={recover} action={{ label: "Go home", href: "/" }} />
    </div>
  );
}
