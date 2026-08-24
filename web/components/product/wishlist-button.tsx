"use client";

import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWishlistStore } from "@/store/wishlist-store";
import { cn } from "@/lib/utils";

export function WishlistButton({
  productId,
  className,
}: {
  productId: string;
  className?: string;
}) {
  const isWishlisted = useWishlistStore((state) =>
    state.productIds.includes(productId)
  );
  const toggle = useWishlistStore((state) => state.toggle);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
      aria-pressed={isWishlisted}
      className={cn(
        "rounded-full bg-background/80 backdrop-blur-sm hover:bg-background",
        className
      )}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(productId);
      }}
    >
      <Heart
        className={cn(
          "size-4",
          isWishlisted ? "fill-destructive text-destructive" : "text-foreground"
        )}
      />
    </Button>
  );
}
