"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatErrorCode, ErrorPart, WidgetAction } from "@/lib/chat/protocol";

/**
 * Every Reserve Pay failure renders through here — only the copy differs, which
 * is why the documented Razorpay codes live in one map rather than one branch
 * per code in the script.
 */
const FAILURE_COPY: Record<ChatErrorCode, { title: string; detail: string }> = {
  insufficient_funds: {
    title: "Not enough funds",
    detail: "Your bank declined the debit for insufficient balance.",
  },
  payment_declined: {
    title: "Payment declined",
    detail: "Your bank turned down this debit. Trying again often works.",
  },
  transaction_limit_exceeded: {
    title: "Over the transaction limit",
    detail: "This order is larger than your per-transaction cap.",
  },
  bank_not_available: {
    title: "Your bank isn't responding",
    detail: "The bank is temporarily unreachable. Nothing has been charged.",
  },
  payment_timed_out: {
    title: "Payment timed out",
    detail: "The debit didn't complete in time. Nothing has been charged.",
  },
  mandate_expired: {
    title: "Your reserve expired",
    detail: "Reserve Pay blocks last up to 90 days. Set up a new one to continue.",
  },
  mandate_revoked: {
    title: "Your reserve was cancelled",
    detail: "This block is no longer active.",
  },
  reserve_insufficient: {
    title: "Reserve is short",
    detail: "There isn't enough left in your block to cover this order.",
  },
  network: {
    title: "Connection problem",
    detail: "I couldn't reach the server. Check your connection.",
  },
  server: { title: "Something went wrong", detail: "That's on us. Try again in a moment." },
  unauthorized: { title: "Session expired", detail: "Log in again to keep going." },
};

export function ErrorWidget({
  part,
  interactive,
  onAction,
}: {
  part: ErrorPart;
  interactive: boolean;
  onAction: (action: WidgetAction) => void;
}) {
  const copy = FAILURE_COPY[part.code];

  return (
    <div className="p-3">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium text-destructive">
        <AlertTriangle className="size-4 shrink-0" />
        {part.title || copy.title}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{part.detail ?? copy.detail}</p>

      {part.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {part.actions.map((entry, index) => (
            <Button
              key={entry.id}
              type="button"
              size="sm"
              variant={index === 0 ? "default" : "outline"}
              disabled={!interactive}
              onClick={() => onAction(entry.action)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
