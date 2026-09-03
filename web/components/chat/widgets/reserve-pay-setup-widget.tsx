"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn, formatPrice } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { ReservePaySetupPart, UpiIntentLinks, WidgetAction } from "@/lib/chat/protocol";

/**
 * Order matters — these render as a grid, most-used first. Keys are `UpiIntentLinks` fields minus
 * `generic`, which is handled separately as the "any UPI app" fallback.
 */
const UPI_APPS: { key: Exclude<keyof UpiIntentLinks, "generic">; label: string }[] = [
  { key: "gpay", label: "Google Pay" },
  { key: "phonepe", label: "PhonePe" },
  { key: "paytm", label: "Paytm" },
  { key: "bhim", label: "BHIM" },
  { key: "cred", label: "CRED" },
  { key: "whatsapp", label: "WhatsApp" },
];

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
  const isDesktop = useMediaQuery("(min-width: 640px)");
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
    return (
      <AwaitingApproval part={part} isDesktop={isDesktop} onAction={onAction} />
    );
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
  isDesktop,
  onAction,
}: {
  part: ReservePaySetupPart;
  isDesktop: boolean;
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

      {isDesktop ? (
        // A upi:// link cannot open anything on a desktop, so hand the phone the mandate instead
        // — scanning is how UPI desktop checkout works everywhere else.
        <div className="mb-3 flex flex-col items-center gap-2 rounded-lg border bg-muted/30 p-3">
          <div className="rounded-md bg-white p-2">
            <QRCodeSVG value={uri} size={132} level="M" />
          </div>
          <p className="text-xs text-muted-foreground">Scan with any UPI app</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(uri);
              toast.success("UPI link copied");
            }}
          >
            <Copy className="size-4" />
            Copy link instead
          </Button>
        </div>
      ) : links ? (
        <div className="mb-3">
          <div className="mb-2 grid grid-cols-2 gap-2">
            {UPI_APPS.map((app) => (
              <Button
                key={app.key}
                variant="outline"
                nativeButton={false}
                render={<a href={links[app.key]} />}
                onClick={() => onAction({ type: "reserve_pay.intent_opened" })}
              >
                {app.label}
              </Button>
            ))}
          </div>
          {/* The generic scheme lets the OS offer whatever the customer actually has installed. */}
          <Button
            className="w-full"
            nativeButton={false}
            render={<a href={links.generic} />}
            onClick={() => onAction({ type: "reserve_pay.intent_opened" })}
          >
            <Smartphone className="size-4" />
            Any UPI app
          </Button>
        </div>
      ) : (
        <Button
          className="mb-2 w-full"
          nativeButton={false}
          render={<a href={uri} />}
          onClick={() => onAction({ type: "reserve_pay.intent_opened" })}
        >
          <Smartphone className="size-4" />
          Approve in UPI app
        </Button>
      )}

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
