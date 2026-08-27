// Admin API surface (backend/API.md §6.10).
//
// Admin auth is a completely separate mechanism from the storefront: a different
// signing secret, a 12h TTL and a `{ role: "admin" }` payload with no `sub`. A user
// token is never accepted here and an admin token is never accepted on a storefront
// route. The invariant is by discipline: admin pages read only `useAdminAuthStore`,
// storefront pages only `useAuthStore`.

import { apiFetch } from "@/lib/api/client";
import type { Category, OrderStatus } from "@/lib/types";
import type {
  AdminOrder,
  AdminOrderSort,
  AdminProduct,
  AdminProductSort,
  AdminUser,
  ArchivedFilter,
  CategoryWithCount,
  DashboardSummary,
  Paginated,
} from "@/lib/admin-types";

/* -------------------------------------------------------------------------- */
/* auth                                                                       */
/* -------------------------------------------------------------------------- */

/** The only public admin route. Exchanges the shared password for an admin JWT. */
export function adminLogin(password: string): Promise<{ token: string }> {
  return apiFetch<{ token: string }>("/api/admin/login", {
    method: "POST",
    body: { password },
  });
}

/* -------------------------------------------------------------------------- */
/* dashboard                                                                  */
/* -------------------------------------------------------------------------- */

export function getDashboard(token: string): Promise<DashboardSummary> {
  // Not wrapped in an envelope — the five keys are top-level.
  return apiFetch<DashboardSummary>("/api/admin/dashboard", { token });
}

/* -------------------------------------------------------------------------- */
/* orders                                                                     */
/* -------------------------------------------------------------------------- */

export type AdminOrderFilters = {
  status?: OrderStatus;
  userId?: string;
  /** ISO-8601 datetime; matches `placedAt >=`. */
  dateFrom?: string;
  /** ISO-8601 datetime; matches `placedAt <=`. Pass end-of-day, not midnight. */
  dateTo?: string;
  /** Substring match on `orderNumber` only — not buyer name or email. */
  q?: string;
  sort?: AdminOrderSort;
  page?: number;
  pageSize?: number;
};

export function getAdminOrders(
  token: string,
  filters: AdminOrderFilters = {}
): Promise<Paginated<AdminOrder>> {
  return apiFetch<Paginated<AdminOrder>>("/api/admin/orders", {
    token,
    searchParams: {
      status: filters.status,
      userId: filters.userId,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      q: filters.q || undefined,
      sort: filters.sort,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  });
}

export async function getAdminOrder(
  token: string,
  id: string
): Promise<AdminOrder> {
  const { order } = await apiFetch<{ order: AdminOrder }>(
    `/api/admin/orders/${id}`,
    { token }
  );
  return order;
}

/** No transition rules server-side — any status can move to any other. */
export async function updateOrderStatus(
  token: string,
  id: string,
  status: OrderStatus
): Promise<AdminOrder> {
  const { order } = await apiFetch<{ order: AdminOrder }>(
    `/api/admin/orders/${id}/status`,
    { method: "PATCH", token, body: { status } }
  );
  return order;
}

/* -------------------------------------------------------------------------- */
/* products                                                                   */
/* -------------------------------------------------------------------------- */

export type AdminProductFilters = {
  /** Substring match on name. */
  q?: string;
  /** A single category slug. */
  category?: string;
  archived?: ArchivedFilter;
  inStock?: boolean;
  sort?: AdminProductSort;
  page?: number;
  pageSize?: number;
};

export type ProductCreateInput = {
  name: string;
  categorySlug: string;
  price: number;
  mrp: number;
  unit: string;
  image: string;
  description: string;
  /** Defaults to `[image]` server-side when omitted. */
  images?: string[];
  /** Defaults to `true` server-side when omitted. */
  inStock?: boolean;
  /** Defaults to `[]` server-side when omitted. */
  tags?: string[];
};

/** `archived: true` stamps `archivedAt`; `false` clears it. `slug` is not patchable. */
export type ProductUpdateInput = Partial<ProductCreateInput> & {
  archived?: boolean;
};

/**
 * DELETE has two success shapes: 204 with an empty body on a real delete, or
 * 200 `{ product, archived: true }` when a past order references the product and
 * the line item has to survive.
 */
export type DeleteProductResult =
  | { deleted: true; product: null }
  | { deleted: false; product: AdminProduct };

export function getAdminProducts(
  token: string,
  filters: AdminProductFilters = {}
): Promise<Paginated<AdminProduct>> {
  return apiFetch<Paginated<AdminProduct>>("/api/admin/products", {
    token,
    searchParams: {
      q: filters.q || undefined,
      category: filters.category,
      archived: filters.archived,
      // The backend expects the string "true"/"false". Note the explicit
      // undefined check — `filters.inStock || undefined` would silently drop
      // the "out of stock only" filter.
      inStock: filters.inStock === undefined ? undefined : String(filters.inStock),
      sort: filters.sort,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  });
}

export async function createProduct(
  token: string,
  data: ProductCreateInput
): Promise<AdminProduct> {
  const { product } = await apiFetch<{ product: AdminProduct }>(
    "/api/admin/products",
    { method: "POST", token, body: data }
  );
  return product;
}

export async function updateProduct(
  token: string,
  id: string,
  data: ProductUpdateInput
): Promise<AdminProduct> {
  const { product } = await apiFetch<{ product: AdminProduct }>(
    `/api/admin/products/${id}`,
    { method: "PATCH", token, body: data }
  );
  return product;
}

export async function deleteProduct(
  token: string,
  id: string
): Promise<DeleteProductResult> {
  // apiFetch already returns undefined for a 204, so this never calls .json()
  // on an empty body.
  const res = await apiFetch<
    { product: AdminProduct; archived: true } | undefined
  >(`/api/admin/products/${id}`, { method: "DELETE", token });

  return res
    ? { deleted: false, product: res.product }
    : { deleted: true, product: null };
}

/* -------------------------------------------------------------------------- */
/* categories                                                                 */
/* -------------------------------------------------------------------------- */

export type CategoryCreateInput = {
  name: string;
  description: string;
  /** A Lucide icon name, e.g. "Carrot". */
  icon: string;
  image: string;
  /** Derived from `name` server-side when omitted. */
  slug?: string;
};

export type CategoryUpdateInput = Partial<CategoryCreateInput>;

/** Unpaginated and unfiltered — returns every category, alphabetical by name. */
export async function getAdminCategories(
  token: string
): Promise<CategoryWithCount[]> {
  const { categories } = await apiFetch<{ categories: CategoryWithCount[] }>(
    "/api/admin/categories",
    { token }
  );
  return categories;
}

export async function createCategory(
  token: string,
  data: CategoryCreateInput
): Promise<Category> {
  const { category } = await apiFetch<{ category: Category }>(
    "/api/admin/categories",
    { method: "POST", token, body: data }
  );
  return category;
}

export async function updateCategory(
  token: string,
  id: string,
  data: CategoryUpdateInput
): Promise<Category> {
  const { category } = await apiFetch<{ category: Category }>(
    `/api/admin/categories/${id}`,
    { method: "PATCH", token, body: data }
  );
  return category;
}

/** 409 CONFLICT if any product still references the category. */
export function deleteCategory(token: string, id: string): Promise<void> {
  return apiFetch<void>(`/api/admin/categories/${id}`, {
    method: "DELETE",
    token,
  });
}

/* -------------------------------------------------------------------------- */
/* users                                                                      */
/* -------------------------------------------------------------------------- */

export type AdminUserFilters = {
  /** Substring match on name or email. */
  q?: string;
  page?: number;
  /** Defaults to 50 server-side (not 20, unlike the other lists). */
  pageSize?: number;
};

export function getAdminUsers(
  token: string,
  filters: AdminUserFilters = {}
): Promise<Paginated<AdminUser>> {
  return apiFetch<Paginated<AdminUser>>("/api/admin/users", {
    token,
    searchParams: {
      q: filters.q || undefined,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  });
}
