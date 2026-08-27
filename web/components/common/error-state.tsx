"use client";

import Link from "next/link";
import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const DEFAULT_ERROR_TITLE = "We're having trouble";
export const DEFAULT_ERROR_DESCRIPTION =
  "We couldn't reach the server. This is usually temporary — please try again in a moment.";

export function ErrorState({
  title = DEFAULT_ERROR_TITLE,
  description = DEFAULT_ERROR_DESCRIPTION,
  onRetry,
  action,
  compact = false,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  action?: { label: string; href: string };
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl text-center",
        compact ? "px-4 py-10" : "border border-dashed py-16"
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <WifiOff className="size-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="font-heading font-medium">{title}</p>
        <p className="max-w-xs text-sm text-muted-foreground">{description}</p>
      </div>
      {(onRetry || action) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <Button size="sm" onClick={onRetry}>
              <RefreshCw className="size-4" />
              Try again
            </Button>
          )}
          {action && (
            <Button
              size="sm"
              variant={onRetry ? "outline" : "default"}
              nativeButton={false}
              render={<Link href={action.href} />}
            >
              {action.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
