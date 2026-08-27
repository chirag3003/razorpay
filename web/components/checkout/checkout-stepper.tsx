import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = ["Address", "Delivery Slot", "Review"];

export function CheckoutStepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2 sm:gap-4">
      {STEPS.map((step, index) => {
        const stepNumber = index + 1;
        const isComplete = stepNumber < current;
        const isActive = stepNumber === current;
        return (
          <li key={step} className="flex flex-1 items-center gap-2 sm:gap-3">
            <div
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                isComplete && "bg-primary text-primary-foreground",
                isActive && "bg-primary text-primary-foreground",
                !isComplete && !isActive && "bg-muted text-muted-foreground"
              )}
            >
              {isComplete ? <Check className="size-3.5" /> : stepNumber}
            </div>
            <span
              className={cn(
                "hidden text-sm font-medium sm:block",
                isActive || isComplete
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {step}
            </span>
            {stepNumber < STEPS.length && (
              <div
                className={cn(
                  "h-px flex-1",
                  isComplete ? "bg-primary" : "bg-border"
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
