import { Separator } from "@/components/ui/separator";
import { formatPrice } from "@/lib/utils";
import { FREE_DELIVERY_THRESHOLD } from "@/lib/constants";

export function CartSummary({
  subtotal,
  deliveryFee,
  total,
  discount = 0,
}: {
  subtotal: number;
  deliveryFee: number;
  total: number;
  discount?: number;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Subtotal</span>
        <span>{formatPrice(subtotal)}</span>
      </div>
      {discount > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Discount</span>
          <span className="text-emerald-600">-{formatPrice(discount)}</span>
        </div>
      )}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Delivery fee</span>
        <span>{deliveryFee === 0 ? "Free" : formatPrice(deliveryFee)}</span>
      </div>
      {deliveryFee > 0 && (
        <p className="text-xs text-muted-foreground">
          Add {formatPrice(FREE_DELIVERY_THRESHOLD - subtotal)} more for free
          delivery
        </p>
      )}
      <Separator />
      <div className="flex items-center justify-between font-heading font-semibold">
        <span>Total</span>
        <span>{formatPrice(total)}</span>
      </div>
    </div>
  );
}
