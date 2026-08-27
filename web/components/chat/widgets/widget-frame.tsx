"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared chrome for every chat widget, and the single place the freeze rule is
 * implemented. Individual widgets never handle their own frozen state.
 *
 * Once a transient widget is answered it collapses to a one-line summary
 * instead of rendering disabled controls — a greyed-out form still reads as
 * "you could have done this", which isn't true five turns later.
 */
export function WidgetFrame({
  interactive,
  answered,
  summary,
  className,
  children,
}: {
  interactive: boolean;
  /** Set once the widget has been answered. */
  answered?: boolean;
  /** Rendered in place of the body when answered. */
  summary?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  if (answered && summary) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <Check className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 truncate">{summary}</span>
      </div>
    );
  }

  return (
    <div
      aria-disabled={!interactive || undefined}
      className={cn(
        "overflow-hidden rounded-xl border bg-card",
        !interactive && "pointer-events-none opacity-70",
        className
      )}
    >
      {children}
    </div>
  );
}

export function WidgetHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-b bg-muted/40 px-3 py-2 font-heading text-xs font-medium text-muted-foreground">
      {children}
    </p>
  );
}
