"use client";

import { AlertTriangle, CreditCard, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/utils";
import { remainingOf } from "@/lib/chat/format";
import type { ReservePayStatusPart, WidgetAction } from "@/lib/chat/protocol";

const ACTION_LABELS: Record<string, { label: string; action: WidgetAction }> = {
  setup: { label: "Set up a reserve", action: { type: "reserve_pay.renew" } },
  top_up: { label: "Top up", action: { type: "reserve_pay.top_up" } },
  renew: { label: "Set up a new reserve", action: { type: "reserve_pay.renew" } },
  use_web_checkout: {
    label: "Pay on the website",
    action: { type: "fallback.web_checkout" },
  },
};

export function ReservePayStatusWidget({
  part,
  interactive,
  onAction,
}: {
  part: ReservePayStatusPart;
  interactive: boolean;
  onAction: (action: WidgetAction) => void;
}) {
  const remaining = remainingOf(part.mandate ?? null);
  const isProblem = part.state !== "active";

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        {isProblem ? (
          <AlertTriangle className="size-4 text-destructive" />
        ) : (
          <Wallet className="size-4 text-primary" />
        )}
        {titleFor(part)}
      </div>

      {part.mandate && (
        <dl className="mb-3 space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <dt>Reserved</dt>
            <dd>{formatPrice(part.mandate.amountBlocked)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Remaining</dt>
            <dd className="font-medium text-foreground">{formatPrice(remaining)}</dd>
          </div>
          {part.needed !== undefined && part.needed > 0 && (
            <div className="flex justify-between">
              <dt>Short by</dt>
              <dd className="font-medium text-destructive">{formatPrice(part.needed)}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="flex flex-wrap gap-2">
        {part.actions.map((key) => {
          const entry = ACTION_LABELS[key];
          if (!entry) return null;
          const isFallback = key === "use_web_checkout";
          return (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={isFallback ? "outline" : "default"}
              disabled={!interactive}
              onClick={() => onAction(entry.action)}
            >
              {isFallback && <CreditCard className="size-4" />}
              {entry.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function titleFor(part: ReservePayStatusPart): string {
  switch (part.state) {
    case "insufficient":
      return "Not enough left in your reserve";
    case "expired":
      return "Your reserve has expired";
    case "revoked":
      return "Your reserve was cancelled";
    case "none":
      return "No reserve set up yet";
    default:
      return "Reserve Pay";
  }
}
