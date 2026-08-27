"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuantityStepper } from "@/components/product/quantity-stepper";
import { formatPrice } from "@/lib/utils";
import { useCartStore } from "@/store/cart-store";
import type { ChatProduct, ProductResultsPart, WidgetAction } from "@/lib/chat/protocol";

/**
 * `live` lifecycle — stays interactive forever. Quantities are read from the
 * cart store rather than the frozen payload, so scrolling back to an old grid
 * always shows the truth.
 */
export function ProductResultsWidget({
  part,
  onAction,
}: {
  part: ProductResultsPart;
  onAction: (action: WidgetAction) => void;
}) {
  return (
    <div className="flex flex-col divide-y">
      {part.products.map((product) => (
        <ProductRow key={product.id} product={product} onAction={onAction} />
      ))}
    </div>
  );
}

function ProductRow({
  product,
  onAction,
}: {
  product: ChatProduct;
  onAction: (action: WidgetAction) => void;
}) {
  const line = useCartStore((s) =>
    s.cart?.items.find((item) => item.product.id === product.id)
  );
  const qty = line?.qty ?? 0;

  return (
    <div className="flex items-center gap-3 p-2.5">
      <img
        src={product.image}
        alt=""
        className="size-12 shrink-0 rounded-lg bg-muted object-cover"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{product.name}</p>
        <p className="text-xs text-muted-foreground">
          {product.unit} · {formatPrice(product.price)}
        </p>
      </div>

      {!product.inStock ? (
        <span className="text-xs text-muted-foreground">Out of stock</span>
      ) : qty > 0 && line ? (
        <QuantityStepper
          qty={qty}
          onIncrement={() =>
            onAction({
              type: "cart.set_qty",
              itemId: line.itemId,
              productId: product.id,
              qty: qty + 1,
            })
          }
          onDecrement={() =>
            onAction({
              type: "cart.set_qty",
              itemId: line.itemId,
              productId: product.id,
              qty: qty - 1,
            })
          }
        />
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            onAction({ type: "cart.add", productId: product.id, name: product.name, qty: 1 })
          }
        >
          <Plus className="size-4" />
          Add
        </Button>
      )}
    </div>
  );
}
