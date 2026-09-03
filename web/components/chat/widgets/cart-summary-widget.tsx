"use client";

import { ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/utils";
import { useCartSummary } from "@/store/cart-store";
import type { CartSummaryPart, ChatCartLine, WidgetAction } from "@/lib/chat/protocol";

/** One row's worth of a cart line, from either the live store or the part. */
type DisplayLine = Pick<ChatCartLine, "itemId" | "name" | "image" | "qty" | "price">;

/**
 * `live` lifecycle. Reads the cart store rather than `part.snapshot` so an old
 * summary in the transcript never shows a stale total; the snapshot is only a
 * fallback for a transcript restored from sessionStorage.
 */
export function CartSummaryWidget({
  part,
  onAction,
}: {
  part: CartSummaryPart;
  onAction: (action: WidgetAction) => void;
}) {
  const live = useCartSummary();
  const itemCount = live.lines.length > 0 ? live.itemCount : part.snapshot.itemCount;
  const subtotal = live.lines.length > 0 ? live.subtotal : part.snapshot.subtotal;
  const deliveryFee = live.lines.length > 0 ? live.deliveryFee : part.snapshot.deliveryFee;
  const total = live.lines.length > 0 ? live.total : part.snapshot.total;

  // Same precedence as the totals above, and for the same reason — mixing live totals with the
  // part's older lines would show a list that doesn't add up to the total beneath it.
  const lines: DisplayLine[] =
    live.lines.length > 0
      ? live.lines.map((line) => ({
          itemId: line.itemId,
          name: line.product.name,
          image: line.product.image,
          qty: line.qty,
          price: line.product.price,
        }))
      : part.lines;

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <ShoppingBag className="size-4 text-primary" />
        {itemCount} item{itemCount === 1 ? "" : "s"}
      </div>

      {lines.length > 0 && (
        <div className="mb-2 flex flex-col divide-y border-y">
          {lines.map((line) => (
            <div key={line.itemId} className="flex items-center gap-2.5 py-2">
              <img
                src={line.image}
                alt=""
                className="size-9 shrink-0 rounded-md bg-muted object-cover"
              />
              <p className="min-w-0 flex-1 truncate text-xs">
                {line.name}
                <span className="text-muted-foreground"> × {line.qty}</span>
              </p>
              <p className="text-xs font-medium">{formatPrice(line.price * line.qty)}</p>
            </div>
          ))}
        </div>
      )}

      <dl className="space-y-1 text-sm">
        <Row label="Subtotal" value={formatPrice(subtotal)} />
        <Row
          label="Delivery"
          value={deliveryFee === 0 ? "Free" : formatPrice(deliveryFee)}
        />
        <div className="flex justify-between border-t pt-1 font-medium">
          <dt>Total</dt>
          <dd>{formatPrice(total)}</dd>
        </div>
      </dl>

      {part.cta === "checkout" && itemCount > 0 && (
        <Button
          type="button"
          className="mt-3 w-full"
          onClick={() => onAction({ type: "cart.checkout" })}
        >
          Check out
        </Button>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
