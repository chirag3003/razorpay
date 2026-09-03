"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UpiApprovalControls } from "@/components/reserve-pay/upi-approval-controls";
import { cn, formatPrice } from "@/lib/utils";
import type { ReservePaySetupPart, WidgetAction } from "@/lib/chat/protocol";

/**
 * The one human step in Reserve Pay: the customer approves a block in their UPI
 * app. Everything after this is headless server-to-server debiting.
 *
 * This widget is patched in place via `part_update` as approval progresses, so
 * the transcript never grows a second bubble for the same block.
 */
export function ReservePaySetupWidget({
  part,
  interactive,
  onAction,
}: {
  part: ReservePaySetupPart;
  interactive: boolean;
  onAction: (action: WidgetAction) => void;
}) {
  const [amount, setAmount] = useState<number>(part.amount ?? part.suggestedAmounts[0] ?? 1000);

  if (part.step === "confirmed") {
    return (
      <div className="flex items-center gap-2 p-3 text-sm">
        <Check className="size-4 shrink-0 text-primary" />
        <span>
          {formatPrice(part.amount ?? 0)} reserved · valid {part.validityDays} days
        </span>
      </div>
    );
  }

  if (part.step === "awaiting_approval") {
    return <AwaitingApproval part={part} onAction={onAction} />;
  }

  const options = part.suggestedAmounts;

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <ShieldCheck className="size-4 text-primary" />
        {part.mode === "top_up" ? "Top up your reserve" : "Reserve funds once"}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Approve once in your UPI app. After that I can pay for orders instantly — no PIN
        each time. Max {formatPrice(part.maxAmount)}, valid {part.validityDays} days.
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setAmount(option)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              option === amount
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "hover:bg-muted"
            )}
          >
            {formatPrice(option)}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          className="flex-1"
          disabled={!interactive}
          onClick={() =>
            onAction({ type: "reserve_pay.choose_amount", amount, mode: part.mode })
          }
        >
          Reserve {formatPrice(amount)}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={!interactive}
          onClick={() => onAction({ type: "reserve_pay.cancel" })}
        >
          Not now
        </Button>
      </div>
    </div>
  );
}

function AwaitingApproval({
  part,
  onAction,
}: {
  part: ReservePaySetupPart;
  onAction: (action: WidgetAction) => void;
}) {
  const [dots, setDots] = useState(0);
  const uri = part.intent?.upiUri ?? "";
  // Absent on transcripts stored before per-app links existed; those fall back to the copy box.
  const links = part.intent?.links;

  useEffect(() => {
    const id = setInterval(() => setDots((d) => (d + 1) % 4), 500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="p-3">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        <Loader2 className="size-4 animate-spin text-primary" />
        Waiting for approval{".".repeat(dots)}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Approve the {formatPrice(part.amount ?? 0)} block in your UPI app.
      </p>

      <div className="mb-3">
        <UpiApprovalControls
          upiUri={uri}
          links={links}
          onOpened={() => onAction({ type: "reserve_pay.intent_opened" })}
        />
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => onAction({ type: "reserve_pay.approved_claim" })}
      >
        I&apos;ve approved it
      </Button>
    </div>
  );
}
