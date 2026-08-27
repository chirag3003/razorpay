import type { Category, Order, OrderStatus, Product, User } from "@/lib/types";

/** Every paginated admin list uses this envelope. */
export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Storefront responses always have `archivedAt: null` (archived rows are filtered
 * out server-side), so it only carries information on the admin surface.
 */
export type AdminProduct = Product & { archivedAt: string | null };

/** Admins aren't scoped to one user, so admin order responses carry the buyer. */
export type AdminOrder = Order & {
  buyer: { id: string; name: string; email: string; phone: string };
};

export type CategoryWithCount = Category & { productCount: number };

export type AdminUser = User & { createdAt: string };

export type AdminOrderSort = "newest" | "oldest" | "total-desc" | "total-asc";

export type AdminProductSort =
  | "newest"
  | "name-asc"
  | "price-asc"
  | "price-desc";

export type ArchivedFilter = "exclude" | "only" | "all";

export type DashboardSummary = {
  // `byStatus` is Partial because the docs never state whether zero-count keys
  // are present in the payload — always read it with `?? 0`.
  orders: { total: number; byStatus: Partial<Record<OrderStatus, number>> };
  revenue: { allTime: number; last30Days: number };
  catalog: {
    products: number;
    archived: number;
    categories: number;
    outOfStock: number;
  };
  users: { total: number };
  recentOrders: AdminOrder[];
};
