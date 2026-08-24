"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuantityStepper } from "@/components/product/quantity-stepper";
import { useCartStore } from "@/store/cart-store";
import { formatPrice } from "@/lib/utils";
import type { Product } from "@/lib/types";

export function CartLineItem({
  product,
  qty,
  compact,
}: {
  product: Product;
  qty: number;
  compact?: boolean;
}) {
  const updateQty = useCartStore((state) => state.updateQty);
  const removeItem = useCartStore((state) => state.removeItem);
  const addItem = useCartStore((state) => state.addItem);

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
            onClick={() => removeItem(product.id)}
          >
            <X className="size-3.5" />
          </Button>
        )}
        <QuantityStepper
          qty={qty}
          onIncrement={() => addItem(product.id)}
          onDecrement={() => updateQty(product.id, qty - 1)}
        />
      </div>
    </div>
  );
}
