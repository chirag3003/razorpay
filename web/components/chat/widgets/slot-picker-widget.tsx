"use client";

import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SlotPickerPart, WidgetAction } from "@/lib/chat/protocol";

export function SlotPickerWidget({
  part,
  onAction,
}: {
  part: SlotPickerPart;
  onAction: (action: WidgetAction) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 p-2.5">
      {part.slots.map((slot) => (
        <button
          key={slot.id}
          type="button"
          disabled={slot.disabled}
          className={cn(
            "rounded-lg border p-2.5 text-left transition-colors",
            "hover:border-primary hover:bg-primary/5",
            "disabled:cursor-not-allowed disabled:opacity-50",
            slot.id === part.selectedId && "border-primary bg-primary/5"
          )}
          onClick={() =>
            onAction({
              type: "slot.select",
              slotId: slot.id,
              label: `${slot.day}, ${slot.time}`,
            })
          }
        >
          <span className="flex items-center gap-1.5 text-xs font-medium">
            <Clock className="size-3.5 text-primary" />
            {slot.day}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{slot.time}</span>
        </button>
      ))}
    </div>
  );
}
