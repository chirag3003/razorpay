"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { QuantityStepper } from "@/components/product/quantity-stepper";
import { useCartStore } from "@/store/cart-store";
import { useAuthStore, handleAuthApiError } from "@/store/auth-store";
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
  const router = useRouter();
  const pathname = usePathname();
  const token = useAuthStore((state) => state.token);
  const line = useCartStore((state) =>
    state.cart?.items.find((item) => item.product.id === productId)
  );
  const addItem = useCartStore((state) => state.addItem);
  const updateQty = useCartStore((state) => state.updateQty);
  const [pending, setPending] = useState(false);

  if (disabled) {
    return (
      <Button variant="outline" size="sm" className={className} disabled>
        Out of stock
      </Button>
    );
  }

  function requireAuth() {
    if (token) return true;
    toast("Login to add items to your cart");
    router.push(`/login?next=${encodeURIComponent(pathname)}`);
    return false;
  }

  const qty = line?.qty ?? 0;

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
        disabled={pending}
        onClick={async () => {
          if (!requireAuth()) return;
          setPending(true);
          try {
            await addItem(productId);
            toast.success(`${productName} added to cart`);
          } catch (err) {
            if (!handleAuthApiError(err)) {
              toast.error("Couldn't add item to cart");
            }
          } finally {
            setPending(false);
          }
        }}
      >
        Add
      </Button>
    );
  }

  return (
    <QuantityStepper
      qty={qty}
      onIncrement={async () => {
        if (!requireAuth()) return;
        setPending(true);
        try {
          await addItem(productId);
        } catch (err) {
          if (!handleAuthApiError(err)) toast.error("Couldn't update cart");
        } finally {
          setPending(false);
        }
      }}
      onDecrement={async () => {
        if (!line) return;
        setPending(true);
        try {
          await updateQty(line.itemId, qty - 1);
        } catch (err) {
          if (!handleAuthApiError(err)) toast.error("Couldn't update cart");
        } finally {
          setPending(false);
        }
      }}
      className={className}
    />
  );
}
