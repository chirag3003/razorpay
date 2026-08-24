import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/lib/types";

const STATUS_LABEL: Record<OrderStatus, string> = {
  placed: "Order Placed",
  confirmed: "Confirmed",
  packed: "Packed",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const STATUS_CLASS: Record<OrderStatus, string> = {
  placed: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
  confirmed: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
  packed: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  out_for_delivery:
    "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  delivered:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  cancelled:
    "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge variant="secondary" className={cn(STATUS_CLASS[status])}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
