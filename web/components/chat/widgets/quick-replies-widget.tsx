"use client";

import { Button } from "@/components/ui/button";
import type { QuickRepliesPart, WidgetAction } from "@/lib/chat/protocol";

export function QuickRepliesWidget({
  part,
  interactive,
  answered,
  onAction,
}: {
  part: QuickRepliesPart;
  interactive: boolean;
  answered: boolean;
  onAction: (action: WidgetAction) => void;
}) {
  // Chips are chrome, not content — once answered they simply disappear rather
  // than leaving a frozen row of dead buttons in the transcript.
  if (answered || !interactive) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {part.options.map((option) => (
        <Button
          key={option.id}
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => onAction({ type: "quick_reply", text: option.send })}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
