"use client";

import { Clock, MapPin, Pencil, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/utils";
import type { OrderReviewPart, WidgetAction } from "@/lib/chat/protocol";

export function OrderReviewWidget({
  part,
  interactive,
  onAction,
}: {
  part: OrderReviewPart;
  interactive: boolean;
  onAction: (action: WidgetAction) => void;
}) {
  return (
    <div>
      <div className="flex flex-col divide-y">
        {part.lines.map((line) => (
          <div key={line.itemId} className="flex items-center gap-2.5 p-2.5">
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

      <div className="space-y-2 border-t p-3 text-xs">
        <DetailRow
          icon={<MapPin className="size-3.5 text-primary" />}
          text={part.address.oneLine}
          onEdit={
            part.editable.includes("address") && interactive
              ? () => onAction({ type: "review.edit", target: "address" })
              : undefined
          }
        />
        <DetailRow
          icon={<Clock className="size-3.5 text-primary" />}
          text={part.slot.label}
          onEdit={
            part.editable.includes("slot") && interactive
              ? () => onAction({ type: "review.edit", target: "slot" })
              : undefined
          }
        />
        <DetailRow
          icon={<Wallet className="size-3.5 text-primary" />}
          text={`Reserve Pay · ${formatPrice(part.payment.remaining)} available`}
        />
      </div>

      <dl className="space-y-1 border-t p-3 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <dt>Subtotal</dt>
          <dd>{formatPrice(part.totals.subtotal)}</dd>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <dt>Delivery</dt>
          <dd>
            {part.totals.deliveryFee === 0 ? "Free" : formatPrice(part.totals.deliveryFee)}
          </dd>
        </div>
        <div className="flex justify-between border-t pt-1 font-medium">
          <dt>Total</dt>
          <dd>{formatPrice(part.totals.total)}</dd>
        </div>
      </dl>

      <div className="p-3 pt-0">
        <Button
          type="button"
          className="w-full"
          disabled={!interactive}
          onClick={() => onAction({ type: "review.confirm" })}
        >
          Confirm &amp; pay {formatPrice(part.totals.total)}
        </Button>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          Debited from your reserve instantly — no PIN needed.
        </p>
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  text,
  onEdit,
}: {
  icon: React.ReactNode;
  text: string;
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{text}</span>
      {onEdit && (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Change"
          onClick={onEdit}
        >
          <Pencil className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
