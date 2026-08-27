"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PackageSearch, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminSearchInput } from "@/components/admin/admin-search-input";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { AdminTableState } from "@/components/admin/admin-table-state";
import { OrderStatusBadge } from "@/components/order/order-status-badge";
import { useAdminList } from "@/hooks/use-admin-list";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { getAdminOrders } from "@/lib/api/admin";
import {
  ADMIN_PAGE_SIZE,
  ORDER_SORTS,
  ORDER_STATUSES,
} from "@/lib/admin-constants";
import { dateInputToIso, formatDateTime } from "@/lib/admin-format";
import { formatPrice } from "@/lib/utils";
import type { AdminOrderSort } from "@/lib/admin-types";
import type { OrderStatus } from "@/lib/types";

const ALL = "all";

function AdminOrdersContent() {
  const searchParams = useSearchParams();
  // The only cross-page filter link (from the users table), read once into state.
  const [userId, setUserId] = useState(searchParams.get("userId") ?? "");

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<OrderStatus | typeof ALL>(ALL);
  const [sort, setSort] = useState<AdminOrderSort>("newest");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const debouncedQuery = useDebouncedValue(query);

  const { items, total, loading, failed, reload } = useAdminList(getAdminOrders, {
    q: debouncedQuery,
    status: status === ALL ? undefined : status,
    userId: userId || undefined,
    dateFrom: dateInputToIso(dateFrom),
    dateTo: dateInputToIso(dateTo, true),
    sort,
    page,
    pageSize: ADMIN_PAGE_SIZE,
  });

  const hasFilters =
    Boolean(query || userId || dateFrom || dateTo) ||
    status !== ALL ||
    sort !== "newest";

  function reset<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  function clearFilters() {
    setQuery("");
    setStatus(ALL);
    setSort("newest");
    setDateFrom("");
    setDateTo("");
    setUserId("");
    setPage(1);
  }

  return (
    <div>
      <AdminPageHeader
        title="Orders"
        description={`${total} ${total === 1 ? "order" : "orders"} matching these filters`}
      />

      <div className="mb-4 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="sm:w-64">
            <Label className="mb-1.5 text-xs text-muted-foreground">
              Search
            </Label>
            {/* The backend matches `q` against orderNumber only — the
                placeholder is the whole mitigation for that. */}
            <AdminSearchInput
              value={query}
              onChange={reset(setQuery)}
              placeholder="Search order number…"
            />
          </div>

          <div>
            <Label className="mb-1.5 text-xs text-muted-foreground">Status</Label>
            <Select
              value={status}
              onValueChange={(value) =>
                reset(setStatus)(value as OrderStatus | typeof ALL)
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {ORDER_STATUSES.map((value) => (
                  <SelectItem key={value} value={value} className="capitalize">
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-1.5 text-xs text-muted-foreground">From</Label>
            <Input
              type="date"
              value={dateFrom}
              className="w-40"
              onChange={(event) => reset(setDateFrom)(event.target.value)}
            />
          </div>

          <div>
            <Label className="mb-1.5 text-xs text-muted-foreground">To</Label>
            <Input
              type="date"
              value={dateTo}
              className="w-40"
              onChange={(event) => reset(setDateTo)(event.target.value)}
            />
          </div>

          <div>
            <Label className="mb-1.5 text-xs text-muted-foreground">Sort</Label>
            <Select
              value={sort}
              onValueChange={(value) =>
                reset(setSort)(value as AdminOrderSort)
              }
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORDER_SORTS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>

        {userId && (
          <Badge variant="secondary" className="gap-1.5">
            Filtered to one buyer
            <button
              type="button"
              aria-label="Clear buyer filter"
              onClick={() => {
                setUserId("");
                setPage(1);
              }}
            >
              <X className="size-3" />
            </button>
          </Badge>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead>Placed</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <AdminTableState
              colSpan={7}
              loading={loading}
              failed={failed}
              isEmpty={items.length === 0}
              onRetry={reload}
              emptyIcon={PackageSearch}
              emptyTitle="No orders found"
              emptyDescription={
                hasFilters
                  ? "No order matches these filters. Try clearing them."
                  : "Orders will appear here once customers start buying."
              }
            />
            {!loading &&
              !failed &&
              items.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-mono text-xs font-medium">
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{order.buyer.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {order.buyer.email}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(order.placedAt)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {order.items.reduce((sum, item) => sum + item.qty, 0)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatPrice(order.total)}
                  </TableCell>
                  <TableCell>
                    <OrderStatusBadge status={order.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      nativeButton={false}
                      render={<Link href={`/admin/orders/${order.id}`} />}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
        <AdminPagination
          page={page}
          pageSize={ADMIN_PAGE_SIZE}
          total={total}
          onPageChange={setPage}
        />
      </Card>
    </div>
  );
}

export default function AdminOrdersPage() {
  // useSearchParams needs a Suspense boundary above it.
  return (
    <Suspense fallback={null}>
      <AdminOrdersContent />
    </Suspense>
  );
}
