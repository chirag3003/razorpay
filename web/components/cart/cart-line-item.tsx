"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuantityStepper } from "@/components/product/quantity-stepper";
import { toast } from "sonner";
import { useCartStore } from "@/store/cart-store";
import { handleAuthApiError } from "@/store/auth-store";
import { formatPrice } from "@/lib/utils";
import type { CartProduct } from "@/lib/types";

export function CartLineItem({
  itemId,
  product,
  qty,
  compact,
}: {
  itemId: string;
  product: CartProduct;
  qty: number;
  compact?: boolean;
}) {
  const updateQty = useCartStore((state) => state.updateQty);
  const removeItem = useCartStore((state) => state.removeItem);
  const addItem = useCartStore((state) => state.addItem);

  // These were fire-and-forget, so a failure surfaced as an unhandled rejection
  // and the row silently stopped responding.
  function run(mutate: () => Promise<void>, message: string) {
    void mutate().catch((err) => {
      if (!handleAuthApiError(err)) toast.error(message);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Link
        href={`/products/${product.slug}`}
        className="size-16 shrink-0 overflow-hidden rounded-lg bg-muted"
      >
        <img
          src={product.image}
          alt={product.name}
          className="size-full object-cover"
        />
      </Link>
      <div className="min-w-0 flex-1 space-y-1">
        <Link
          href={`/products/${product.slug}`}
          className="line-clamp-1 text-sm font-medium hover:underline"
        >
          {product.name}
        </Link>
        <p className="text-xs text-muted-foreground">{product.unit}</p>
        <p className="text-sm font-medium">{formatPrice(product.price)}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        {!compact && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove item"
            onClick={() =>
              run(() => removeItem(itemId), "Couldn't remove item")
            }
          >
            <X className="size-3.5" />
          </Button>
        )}
        <QuantityStepper
          qty={qty}
          onIncrement={() =>
            run(() => addItem(product.id), "Couldn't update cart")
          }
          onDecrement={() =>
            run(() => updateQty(itemId, qty - 1), "Couldn't update cart")
          }
        />
      </div>
    </div>
  );
}
