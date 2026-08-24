"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function QuantityStepper({
  qty,
  onIncrement,
  onDecrement,
  className,
}: {
  qty: number;
  onIncrement: () => void;
  onDecrement: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-lg border border-primary bg-primary/5",
        className
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-primary hover:bg-primary/10"
        onClick={onDecrement}
        aria-label="Decrease quantity"
      >
        <Minus className="size-3.5" />
      </Button>
      <span className="min-w-4 text-center text-sm font-medium tabular-nums">
        {qty}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-primary hover:bg-primary/10"
        onClick={onIncrement}
        aria-label="Increase quantity"
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}
