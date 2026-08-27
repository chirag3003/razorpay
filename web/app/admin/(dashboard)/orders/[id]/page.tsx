"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2, PackageX } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { OrderStatusBadge } from "@/components/order/order-status-badge";
import { OrderTimeline } from "@/components/order/order-timeline";
import { OrderStatusControl } from "@/components/admin/order-status-control";
import { getAdminOrder } from "@/lib/api/admin";
import { useAdminAuthStore, handleAdminApiError } from "@/store/admin-auth-store";
import { ApiError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/admin-format";
import { formatPrice } from "@/lib/utils";
import type { AdminOrder } from "@/lib/admin-types";

export default function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const token = useAdminAuthStore((state) => state.token);
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  function retry() {
    setLoading(true);
    setNotFound(false);
    setLoadError(false);
    setReloadKey((key) => key + 1);
  }

  useEffect(() => {
    if (!token) return;
    let ignore = false;

    getAdminOrder(token, id)
      .then((data) => {
        if (!ignore) setOrder(data);
      })
      .catch((err) => {
        if (ignore) return;
        handleAdminApiError(err);
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
      <ErrorState
        onRetry={retry}
        action={{ label: "Back to orders", href: "/admin/orders" }}
      />
    );
  }

  if (notFound || !order) {
    return (
      <EmptyState
        icon={PackageX}
        title="Order not found"
        description="This order doesn't exist. It may have been removed."
        action={{ label: "Back to orders", href: "/admin/orders" }}
      />
    );
  }

  return (
    <div>
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Admin</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin/orders">Orders</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{order.orderNumber}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="font-heading text-2xl font-semibold">
              {order.orderNumber}
            </h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            Placed on {formatDateTime(order.placedAt)}
          </p>
        </div>
        <OrderStatusControl order={order} onUpdated={setOrder} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card className="p-5">
            <p className="mb-4 font-heading font-medium">Order status</p>
            <OrderTimeline status={order.status} />
          </Card>

          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Line total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((item) => (
                  <TableRow key={item.productId}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <img
                          src={item.product.image}
                          alt=""
                          className="size-10 shrink-0 rounded-md object-cover"
                        />
                        <div className="min-w-0">
                          <p className="line-clamp-1 font-medium">
                            {item.product.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.product.unit}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{item.qty}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {/* Frozen at order time — not the live product price. */}
                      {formatPrice(item.priceAtPurchase)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatPrice(item.priceAtPurchase * item.qty)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <p className="font-heading font-medium">Buyer</p>
            <div className="space-y-0.5 text-sm">
              <p className="font-medium">{order.buyer.name}</p>
              <p className="text-muted-foreground">{order.buyer.email}</p>
              <p className="text-muted-foreground">{order.buyer.phone}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              nativeButton={false}
              render={
                <Link href={`/admin/orders?userId=${order.buyer.id}`} />
              }
            >
              All orders by this buyer
            </Button>
          </Card>

          <Card className="space-y-3 p-4">
            <p className="font-heading font-medium">Delivery</p>
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{order.address.name}</p>
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
          </Card>

          <Card className="space-y-3 p-4">
            <p className="font-heading font-medium">Payment</p>
            <div className="text-sm">
              <p className="text-muted-foreground">Method</p>
              <p className="font-medium capitalize">{order.paymentMethod}</p>
            </div>
            <div className="text-sm">
              <p className="text-muted-foreground">Razorpay order</p>
              <p className="font-mono text-xs break-all">
                {order.razorpayOrderId || "—"}
              </p>
            </div>
            <div className="text-sm">
              <p className="text-muted-foreground">Razorpay payment</p>
              <p className="font-mono text-xs break-all">
                {order.razorpayPaymentId || "—"}
              </p>
            </div>
          </Card>

          <Card className="space-y-2.5 p-4">
            <p className="font-heading font-medium">Bill summary</p>
            <Row label="Subtotal" value={formatPrice(order.subtotal)} />
            {order.discount > 0 && (
              <Row
                label="Discount"
                value={`-${formatPrice(order.discount)}`}
                accent
              />
            )}
            <Row
              label="Delivery fee"
              value={
                order.deliveryFee === 0
                  ? "Free"
                  : formatPrice(order.deliveryFee)
              }
            />
            <Separator />
            <div className="flex items-center justify-between font-heading font-semibold">
              <span>Total</span>
              <span>{formatPrice(order.total)}</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={accent ? "text-emerald-600" : undefined}>{value}</span>
    </div>
  );
}
