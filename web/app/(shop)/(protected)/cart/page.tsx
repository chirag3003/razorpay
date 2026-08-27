"use client";

import Link from "next/link";
import { Loader2, ShoppingBag, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { CartLineItem } from "@/components/cart/cart-line-item";
import { CartSummary } from "@/components/cart/cart-summary";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { useCartSummary, useCartStore } from "@/store/cart-store";

export default function CartPage() {
  const { lines, subtotal, deliveryFee, total, itemCount } = useCartSummary();
  const status = useCartStore((state) => state.status);
  const clear = useCartStore((state) => state.clear);
  const fetchCart = useCartStore((state) => state.fetchCart);

  if (status === "idle" || status === "loading") {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <ErrorState
          title="Couldn't load your cart"
          description="We couldn't reach the server. Please try again in a moment."
          onRetry={() => fetchCart()}
        />
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <EmptyState
          icon={ShoppingBag}
          title="Your cart is empty"
          description="Looks like you haven't added anything to your cart yet."
          action={{ label: "Start shopping", href: "/products" }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold">
          Your Cart ({itemCount})
        </h1>
        <Button variant="ghost" size="sm" onClick={() => clear()}>
          Clear cart
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="divide-y p-4">
          {lines.map((line, index) => (
            <div key={line.itemId} className={index > 0 ? "pt-4" : undefined}>
              <CartLineItem itemId={line.itemId} product={line.product} qty={line.qty} />
            </div>
          ))}
        </Card>

        <div className="space-y-4">
          <Card className="space-y-4 p-4">
            <InputGroup>
              <InputGroupAddon>
                <Tag className="size-4" />
              </InputGroupAddon>
              <InputGroupInput placeholder="Promo code" />
              <InputGroupAddon align="inline-end">
                <InputGroupButton>Apply</InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <Separator />
            <CartSummary subtotal={subtotal} deliveryFee={deliveryFee} total={total} />
            <Button
              className="w-full"
              size="lg"
              nativeButton={false}
              render={<Link href="/checkout" />}
            >
              Proceed to Checkout
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
