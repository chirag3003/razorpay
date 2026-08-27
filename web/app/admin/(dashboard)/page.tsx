"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  Archive,
  IndianRupee,
  Package,
  PackageX,
  ShoppingBag,
  Tags,
  TrendingUp,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { StatCard } from "@/components/admin/stat-card";
import { ErrorState } from "@/components/common/error-state";
import { OrderStatusBadge } from "@/components/order/order-status-badge";
import { getDashboard } from "@/lib/api/admin";
import { useAdminAuthStore, handleAdminApiError } from "@/store/admin-auth-store";
import { ORDER_STATUSES } from "@/lib/admin-constants";
import { formatDateTime } from "@/lib/admin-format";
import { formatPrice } from "@/lib/utils";
import type { DashboardSummary } from "@/lib/admin-types";

const chartConfig: ChartConfig = {
  count: { label: "Orders", color: "var(--chart-1)" },
};

export default function AdminDashboardPage() {
  const token = useAdminAuthStore((state) => state.token);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  function retry() {
    setLoading(true);
    setFailed(false);
    setReloadKey((key) => key + 1);
  }

  useEffect(() => {
    if (!token) return;
    let ignore = false;

    getDashboard(token)
      .then((data) => {
        if (!ignore) setSummary(data);
      })
      .catch((err) => {
        if (ignore) return;
        handleAdminApiError(err);
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
      <div>
        <AdminPageHeader title="Dashboard" description="Store overview" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="mt-6 h-64 rounded-xl" />
      </div>
    );
  }

  if (failed || !summary) {
    return (
      <div>
        <AdminPageHeader title="Dashboard" description="Store overview" />
        <ErrorState onRetry={retry} />
      </div>
    );
  }

  // byStatus keys aren't guaranteed by the contract, so default each to 0.
  const statusData = ORDER_STATUSES.map((status) => ({
    status,
    label: status[0].toUpperCase() + status.slice(1),
    count: summary.orders.byStatus[status] ?? 0,
  }));

  return (
    <div>
      <AdminPageHeader title="Dashboard" description="Store overview" />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Revenue (all time)"
          value={formatPrice(summary.revenue.allTime)}
          hint="Excludes cancelled orders"
          icon={IndianRupee}
        />
        <StatCard
          label="Revenue (30 days)"
          value={formatPrice(summary.revenue.last30Days)}
          icon={TrendingUp}
        />
        <StatCard
          label="Orders"
          value={summary.orders.total}
          icon={ShoppingBag}
        />
        <StatCard label="Customers" value={summary.users.total} icon={Users} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active products"
          value={summary.catalog.products}
          icon={Package}
        />
        <StatCard
          label="Archived"
          value={summary.catalog.archived}
          icon={Archive}
        />
        <StatCard
          label="Categories"
          value={summary.catalog.categories}
          icon={Tags}
        />
        <StatCard
          label="Out of stock"
          value={summary.catalog.outOfStock}
          icon={PackageX}
          accent={summary.catalog.outOfStock > 0 ? "warning" : "default"}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
        <Card className="p-4">
          <p className="mb-4 font-heading font-medium">Orders by status</p>
          <ChartContainer config={chartConfig} className="aspect-square w-full">
            <BarChart
              accessibilityLayer
              data={statusData}
              layout="vertical"
              margin={{ left: 8, right: 16 }}
            >
              <CartesianGrid horizontal={false} />
              <YAxis
                dataKey="label"
                type="category"
                tickLine={false}
                axisLine={false}
                width={80}
              />
              <XAxis type="number" allowDecimals={false} hide />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="count" fill="var(--color-count)" radius={5} />
            </BarChart>
          </ChartContainer>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="font-heading font-medium">Recent orders</p>
            <Button
              variant="link"
              size="sm"
              nativeButton={false}
              render={<Link href="/admin/orders" />}
            >
              View all
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Buyer</TableHead>
                <TableHead>Placed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.recentOrders.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={5}
                    className="h-32 text-center text-sm text-muted-foreground"
                  >
                    No orders yet.
                  </TableCell>
                </TableRow>
              )}
              {summary.recentOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-mono text-xs font-medium">
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{order.buyer.name}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(order.placedAt)}
                  </TableCell>
                  <TableCell>
                    <OrderStatusBadge status={order.status} />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatPrice(order.total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
