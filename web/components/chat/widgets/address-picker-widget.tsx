"use client";

import { MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addressOneLine } from "@/lib/chat/format";
import { useChatStore } from "@/store/chat-store";
import type { AddressPickerPart, WidgetAction } from "@/lib/chat/protocol";

export function AddressPickerWidget({
  part,
  onAction,
}: {
  part: AddressPickerPart;
  onAction: (action: WidgetAction) => void;
}) {
  // The agent doesn't know the user's addresses — the store fetched them from
  // the real API, so read them here rather than trusting the payload.
  const addresses = useChatStore((s) => s.addresses);
  const options = addresses.length > 0 ? addresses : [];

  return (
    <div className="flex flex-col divide-y">
      {options.map((address) => (
        <button
          key={address.id}
          type="button"
          className="flex items-start gap-2.5 p-3 text-left transition-colors hover:bg-muted/60"
          onClick={() =>
            onAction({
              type: "address.select",
              addressId: address.id,
              oneLine: `${address.type} · ${addressOneLine(address)}`,
            })
          }
        >
          <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">
              {address.type}
              {address.isDefault && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  Default
                </span>
              )}
            </span>
            <span className="block text-xs text-muted-foreground">
              {addressOneLine(address)}
            </span>
          </span>
        </button>
      ))}

      {part.allowAdd && (
        <Button
          type="button"
          variant="ghost"
          className="justify-start rounded-none px-3 py-3 text-primary"
          onClick={() => onAction({ type: "address.add_requested" })}
        >
          <Plus className="size-4" />
          Use a new address
        </Button>
      )}
    </div>
  );
}
