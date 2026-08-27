"use client";

import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWishlistStore } from "@/store/wishlist-store";
import { cn } from "@/lib/utils";
import type { Product } from "@/lib/types";

export function WishlistButton({
  product,
  className,
}: {
  product: Product;
  className?: string;
}) {
  const isWishlisted = useWishlistStore((state) =>
    state.products.some((p) => p.id === product.id)
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
        toggle(product);
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
