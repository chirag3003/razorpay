"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, PackageCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { OrderStatusBadge } from "@/components/order/order-status-badge";
import { ReorderButton } from "@/components/order/reorder-button";
import { getOrders } from "@/lib/api/orders";
import { useAuthStore, handleAuthApiError } from "@/store/auth-store";
import { formatPrice } from "@/lib/utils";
import type { Order } from "@/lib/types";

export default function OrdersPage() {
  const token = useAuthStore((state) => state.token);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  function retry() {
    setLoading(true);
    setFailed(false);
    setReloadKey((k) => k + 1);
  }

  useEffect(() => {
    if (!token) return;
    let ignore = false;
    getOrders(token)
      .then((data) => {
        if (!ignore) setOrders(data);
      })
      .catch((err) => {
        if (ignore) return;
        if (handleAuthApiError(err)) return;
        setFailed(true);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [token, reloadKey]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (failed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 font-heading text-2xl font-semibold">Your Orders</h1>
        <ErrorState onRetry={retry} />
      </div>
    );
  }

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
              .map((item) => item.product.image);

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
