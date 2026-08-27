"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { updateOrderStatus } from "@/lib/api/admin";
import { ORDER_STATUSES } from "@/lib/admin-constants";
import { useAdminAuthStore, handleAdminApiError } from "@/store/admin-auth-store";
import { ApiError } from "@/lib/api/client";
import type { AdminOrder } from "@/lib/admin-types";
import type { OrderStatus } from "@/lib/types";

export function OrderStatusControl({
  order,
  onUpdated,
}: {
  order: AdminOrder;
  onUpdated: (order: AdminOrder) => void;
}) {
  const token = useAdminAuthStore((state) => state.token);
  const [draft, setDraft] = useState<OrderStatus>(order.status);
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const dirty = draft !== order.status;

  async function apply(status: OrderStatus) {
    if (!token) return;
    setPending(true);
    try {
      const updated = await updateOrderStatus(token, order.id, status);
      onUpdated(updated);
      toast.success(`Order marked ${status}`);
    } catch (err) {
      if (!handleAdminApiError(err)) {
        toast.error(
          err instanceof ApiError ? err.message : "Couldn't update the status"
        );
      }
      setDraft(order.status);
    } finally {
      setPending(false);
      setConfirmOpen(false);
    }
  }

  function handleSave() {
    // Cancelling is the one transition worth a second look — the backend has no
    // transition rules and no refund side effect.
    if (draft === "cancelled") {
      setConfirmOpen(true);
      return;
    }
    apply(draft);
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Select
          value={draft}
          onValueChange={(value) => setDraft(value as OrderStatus)}
        >
          <SelectTrigger className="w-40" disabled={pending}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORDER_STATUSES.map((value) => (
              <SelectItem key={value} value={value} className="capitalize">
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={!dirty || pending} onClick={handleSave}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Cancel this order?"
        description="This marks the order cancelled and removes it from revenue totals. It does not issue a refund — handle that in Razorpay separately."
        confirmLabel="Cancel order"
        destructive
        pending={pending}
        onConfirm={() => apply("cancelled")}
      />
    </>
  );
}
