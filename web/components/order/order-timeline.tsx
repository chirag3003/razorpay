import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/lib/types";

const FLOW: { status: OrderStatus; label: string }[] = [
  { status: "placed", label: "Order Placed" },
  { status: "shipped", label: "Shipped" },
  { status: "delivered", label: "Delivered" },
];

export function OrderTimeline({ status }: { status: OrderStatus }) {
  if (status === "cancelled") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <X className="size-4" />
        </div>
        <p className="text-sm font-medium text-destructive">
          This order was cancelled
        </p>
      </div>
    );
  }

  const currentIndex = FLOW.findIndex((step) => step.status === status);

  return (
    <ol className="flex flex-col gap-0">
      {FLOW.map((step, index) => {
        const isComplete = index <= currentIndex;
        const isLast = index === FLOW.length - 1;
        return (
          <li key={step.status} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-[10px]",
                  isComplete
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {isComplete && <Check className="size-3" />}
              </div>
              {!isLast && (
                <div
                  className={cn(
                    "w-px flex-1",
                    index < currentIndex ? "bg-primary" : "bg-border"
                  )}
                  style={{ minHeight: "1.5rem" }}
                />
              )}
            </div>
            <p
              className={cn(
                "pb-6 text-sm font-medium",
                isComplete ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {step.label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
