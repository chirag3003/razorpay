"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Loader2, PackageX } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/order/order-status-badge";
import { OrderTimeline } from "@/components/order/order-timeline";
import { ReorderButton } from "@/components/order/reorder-button";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { getOrderById } from "@/lib/api/orders";
import { useAuthStore } from "@/store/auth-store";
import { formatPrice } from "@/lib/utils";
import { ApiError } from "@/lib/api/client";
import type { Order } from "@/lib/types";

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const token = useAuthStore((state) => state.token);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  function retry() {
    setLoading(true);
    setNotFound(false);
    setLoadError(false);
    setReloadKey((k) => k + 1);
  }

  useEffect(() => {
    if (!token) return;
    let ignore = false;
    getOrderById(token, id)
      .then((data) => {
        if (!ignore) setOrder(data);
      })
      .catch((err) => {
        if (ignore) return;
        if (err instanceof ApiError && err.code === "NOT_FOUND") {
          setNotFound(true);
        } else {
          setLoadError(true);
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [token, id, reloadKey]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <ErrorState onRetry={retry} action={{ label: "Back to orders", href: "/orders" }} />
      </div>
    );
  }

  if (notFound || !order) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <EmptyState
          icon={PackageX}
          title="Order not found"
          description="This order doesn't exist or isn't yours."
          action={{ label: "Back to orders", href: "/orders" }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/orders">Orders</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{order.orderNumber}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">
            {order.orderNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            Placed on{" "}
            {new Date(order.placedAt).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <OrderStatusBadge status={order.status} />
          <ReorderButton items={order.items} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <Card className="p-5">
            <p className="mb-4 font-heading font-medium">Order status</p>
            <OrderTimeline status={order.status} />
          </Card>

          <Card className="divide-y p-4">
            {order.items.map((item, index) => (
              <div
                key={item.productId}
                className={`flex items-center gap-3 ${index > 0 ? "pt-4" : ""}`}
              >
                <img
                  src={item.product.image}
                  alt={item.product.name}
                  className="size-14 shrink-0 rounded-lg object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-sm font-medium">
                    {item.product.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.product.unit} · Qty {item.qty}
                  </p>
                </div>
                <p className="text-sm font-medium">
                  {formatPrice(item.priceAtPurchase * item.qty)}
                </p>
              </div>
            ))}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <p className="font-heading font-medium">Delivery details</p>
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                {order.address.name}
              </p>
              <p>
                {order.address.line1}
                {order.address.line2 && `, ${order.address.line2}`},{" "}
                {order.address.city}, {order.address.state}{" "}
                {order.address.pincode}
              </p>
              <p>{order.address.phone}</p>
            </div>
            <Separator />
            <div className="text-sm">
              <p className="text-muted-foreground">Delivery slot</p>
              <p className="font-medium">{order.deliverySlot}</p>
            </div>
            <div className="text-sm">
              <p className="text-muted-foreground">Payment method</p>
              <p className="font-medium capitalize">{order.paymentMethod}</p>
            </div>
          </Card>

          <Card className="space-y-2.5 p-4">
            <p className="font-heading font-medium">Bill summary</p>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatPrice(order.subtotal)}</span>
            </div>
            {order.discount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Discount</span>
                <span className="text-emerald-600">
                  -{formatPrice(order.discount)}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Delivery fee</span>
              <span>
                {order.deliveryFee === 0
                  ? "Free"
                  : formatPrice(order.deliveryFee)}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between font-heading font-semibold">
              <span>Total</span>
              <span>{formatPrice(order.total)}</span>
            </div>
          </Card>

          <Button variant="outline" className="w-full" nativeButton={false} render={<Link href="/orders" />}>
            Back to orders
          </Button>
        </div>
      </div>
    </div>
  );
}
