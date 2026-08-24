"use client";

import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCartStore } from "@/store/cart-store";
import type { OrderItem } from "@/lib/types";

export function ReorderButton({ items }: { items: OrderItem[] }) {
  const addItem = useCartStore((state) => state.addItem);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        items.forEach((item) => addItem(item.productId, item.qty));
        toast.success("Items added to cart");
      }}
    >
      <RotateCcw className="size-3.5" />
      Reorder
    </Button>
  );
}
