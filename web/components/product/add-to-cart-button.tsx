"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { QuantityStepper } from "@/components/product/quantity-stepper";
import { useCartStore } from "@/store/cart-store";
import { cn } from "@/lib/utils";

export function AddToCartButton({
  productId,
  productName,
  className,
  disabled,
}: {
  productId: string;
  productName: string;
  className?: string;
  disabled?: boolean;
}) {
  const qty = useCartStore(
    (state) => state.items.find((item) => item.productId === productId)?.qty ?? 0
  );
  const addItem = useCartStore((state) => state.addItem);
  const updateQty = useCartStore((state) => state.updateQty);

  if (disabled) {
    return (
      <Button variant="outline" size="sm" className={className} disabled>
        Out of stock
      </Button>
    );
  }

  if (qty === 0) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          "border-primary text-primary hover:bg-primary/10 hover:text-primary",
          className
        )}
        onClick={() => {
          addItem(productId);
          toast.success(`${productName} added to cart`);
        }}
      >
        Add
      </Button>
    );
  }

  return (
    <QuantityStepper
      qty={qty}
      onIncrement={() => addItem(productId)}
      onDecrement={() => updateQty(productId, qty - 1)}
      className={className}
    />
  );
}
