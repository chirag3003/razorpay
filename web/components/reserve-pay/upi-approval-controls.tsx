"use client";

import { QRCodeSVG } from "qrcode.react";
import { Copy, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { UpiIntentLinks } from "@/lib/chat/protocol";

/**
 * The UPI approval control, shared by the chat widget and the standalone /approve page so the two
 * cannot drift. A `upi://` link opens nothing on a desktop, so the split is by device, not by
 * surface: app buttons on a phone, a scannable QR otherwise.
 */

/** Order matters — rendered as a grid, most-used first. `generic` is the fallback below them. */
const UPI_APPS: { key: Exclude<keyof UpiIntentLinks, "generic">; label: string }[] = [
  { key: "gpay", label: "Google Pay" },
  { key: "phonepe", label: "PhonePe" },
  { key: "paytm", label: "Paytm" },
  { key: "bhim", label: "BHIM" },
  { key: "cred", label: "CRED" },
  { key: "whatsapp", label: "WhatsApp" },
];

export function UpiApprovalControls({
  upiUri,
  links,
  onOpened,
}: {
  upiUri: string;
  /** Absent on transcripts stored before per-app links existed — falls back to the raw URI. */
  links?: UpiIntentLinks | null;
  onOpened?: () => void;
}) {
  const isDesktop = useMediaQuery("(min-width: 640px)");

  if (isDesktop) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border bg-muted/30 p-3">
        <div className="rounded-md bg-white p-2">
          <QRCodeSVG value={upiUri} size={132} level="M" />
        </div>
        <p className="text-xs text-muted-foreground">Scan with any UPI app</p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(upiUri);
            toast.success("UPI link copied");
          }}
        >
          <Copy className="size-4" />
          Copy link instead
        </Button>
      </div>
    );
  }

  if (!links) {
    return (
      <Button className="w-full" nativeButton={false} render={<a href={upiUri} />} onClick={onOpened}>
        <Smartphone className="size-4" />
        Approve in UPI app
      </Button>
    );
  }

  return (
    <div>
      <div className="mb-2 grid grid-cols-2 gap-2">
        {UPI_APPS.map((app) => (
          <Button
            key={app.key}
            variant="outline"
            nativeButton={false}
            render={<a href={links[app.key]} />}
            onClick={onOpened}
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
        onClick={onOpened}
      >
        <Smartphone className="size-4" />
        Any UPI app
      </Button>
    </div>
  );
}
