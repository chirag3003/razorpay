"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CartLineItem } from "@/components/cart/cart-line-item";
import { CartSummary } from "@/components/cart/cart-summary";
import { EmptyState } from "@/components/common/empty-state";
import { useCartSummary } from "@/store/cart-store";

export function CartSheet() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { lines, subtotal, itemCount } = useCartSummary();

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Open cart"
        className="relative"
        onClick={() => setOpen(true)}
      >
        <ShoppingCart className="size-5" />
        {itemCount > 0 && (
          <Badge className="absolute -top-1 -right-1 size-4.5 justify-center rounded-full p-0 text-[10px]">
            {itemCount > 99 ? "99+" : itemCount}
          </Badge>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          showCloseButton
          className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        >
          <SheetHeader className="border-b p-4">
            <SheetTitle>
              Your Cart {itemCount > 0 && `(${itemCount})`}
            </SheetTitle>
          </SheetHeader>

          {lines.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                icon={ShoppingBag}
                title="Your cart is empty"
                description="Add some fresh groceries to get started."
                action={{ label: "Start shopping", href: "/products" }}
              />
            </div>
          ) : (
            <>
              <ScrollArea className="flex-1">
                <div className="flex flex-col gap-4 p-4">
                  {lines.map((line) => (
                    <CartLineItem
                      key={line.product.id}
                      product={line.product}
                      qty={line.qty}
                    />
                  ))}
                </div>
              </ScrollArea>
              <SheetFooter className="gap-3 border-t bg-background p-4">
                <CartSummary subtotal={subtotal} />
                <Button
                  className="w-full"
                  onClick={() => {
                    setOpen(false);
                    router.push("/checkout");
                  }}
                >
                  Proceed to Checkout
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setOpen(false);
                    router.push("/cart");
                  }}
                >
                  View Cart
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
