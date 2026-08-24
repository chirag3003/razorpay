import { cn, discountPercent, formatPrice } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function PriceTag({
  price,
  mrp,
  size = "default",
  className,
}: {
  price: number;
  mrp: number;
  size?: "default" | "lg";
  className?: string;
}) {
  const discount = discountPercent(price, mrp);

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span
        className={cn(
          "font-heading font-semibold",
          size === "lg" ? "text-2xl" : "text-sm"
        )}
      >
        {formatPrice(price)}
      </span>
      {discount > 0 && (
        <>
          <span
            className={cn(
              "text-muted-foreground line-through",
              size === "lg" ? "text-base" : "text-xs"
            )}
          >
            {formatPrice(mrp)}
          </span>
          <Badge
            variant="secondary"
            className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
          >
            {discount}% OFF
          </Badge>
        </>
      )}
    </div>
  );
}
