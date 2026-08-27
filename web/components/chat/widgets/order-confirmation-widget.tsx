"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/utils";
import { useChatStore } from "@/store/chat-store";
import type { OrderConfirmationPart } from "@/lib/chat/protocol";

export function OrderConfirmationWidget({ part }: { part: OrderConfirmationPart }) {
  const closeChat = useChatStore((s) => s.closeChat);

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <CheckCircle2 className="size-4 text-primary" />
        Order placed
      </div>

      <dl className="space-y-1 text-xs text-muted-foreground">
        <div className="flex justify-between">
          <dt>Order</dt>
          <dd className="font-mono text-foreground">{part.orderNumber}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Paid</dt>
          <dd className="font-medium text-foreground">{formatPrice(part.debited)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Reserve left</dt>
          <dd>{formatPrice(part.remainingAfter)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Arriving</dt>
          <dd>{part.slotLabel}</dd>
        </div>
      </dl>

      <Button
        variant="outline"
        size="sm"
        className="mt-3 w-full"
        nativeButton={false}
        render={<Link href={part.href} />}
        onClick={closeChat}
      >
        Track order
      </Button>
    </div>
  );
}
