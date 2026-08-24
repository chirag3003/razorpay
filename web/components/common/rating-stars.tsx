import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function RatingStars({
  rating,
  className,
}: {
  rating: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {Array.from({ length: 5 }).map((_, index) => {
        const filled = index < Math.round(rating);
        return (
          <Star
            key={index}
            className={cn(
              "size-3.5",
              filled
                ? "fill-amber-400 text-amber-400"
                : "fill-muted text-muted-foreground/40"
            )}
          />
        );
      })}
    </div>
  );
}
