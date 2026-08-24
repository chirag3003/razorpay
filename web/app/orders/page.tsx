import Link from "next/link";
import { PackageCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/common/empty-state";
import { OrderStatusBadge } from "@/components/order/order-status-badge";
import { ReorderButton } from "@/components/order/reorder-button";
import { getOrders, getProductById } from "@/lib/queries";
import { formatPrice } from "@/lib/utils";

export default function OrdersPage() {
  const orders = getOrders();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-6 font-heading text-2xl font-semibold">
        Your Orders
      </h1>

      {orders.length === 0 ? (
        <EmptyState
          icon={PackageCheck}
          title="No orders yet"
          description="Your past orders will show up here once you place one."
          action={{ label: "Start shopping", href: "/products" }}
        />
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const itemCount = order.items.reduce((sum, i) => sum + i.qty, 0);
            const previewImages = order.items
              .slice(0, 4)
              .map((item) => getProductById(item.productId)?.image)
              .filter((src): src is string => Boolean(src));

            return (
              <Card key={order.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-heading font-medium">
                      {order.orderNumber}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(order.placedAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <OrderStatusBadge status={order.status} />
                </div>

                <Separator className="my-3" />

                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {previewImages.map((src, index) => (
                      <img
                        key={index}
                        src={src}
                        alt=""
                        className="size-10 rounded-md object-cover"
                      />
                    ))}
                    <p className="text-sm text-muted-foreground">
                      {itemCount} item{itemCount !== 1 && "s"} ·{" "}
                      {formatPrice(order.total)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ReorderButton items={order.items} />
                    <Button
                      size="sm"
                      variant="secondary"
                      nativeButton={false}
                      render={<Link href={`/orders/${order.id}`} />}
                    >
                      View Details
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
