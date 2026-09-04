import { and, asc, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { orders, users } from "../db/schema";
import { NotFoundError } from "../errors";
import type { OrderStatus } from "../constants";
import * as auditService from "./auditService";
import * as orderService from "./orderService";
import type { AdminOrderQuery } from "../schemas/admin-order.schema";

const buyerSelect = {
  id: users.id,
  name: users.name,
  email: users.email,
  phone: users.phone,
};

type Buyer = { id: string; name: string; email: string; phone: string };

// The storefront's order+items+product shape plus the buyer — admins are not scoped to a user.
// Single-order path only; listOrders hydrates a whole page in one query via attachItems.
async function withDetail(orderId: string, buyer: Buyer) {
  const detail = await orderService.getOrderWithItems(orderId);
  return { ...detail, buyer };
}

export async function listOrders(query: AdminOrderQuery) {
  const conditions = [];
  if (query.status) conditions.push(eq(orders.status, query.status));
  if (query.userId) conditions.push(eq(orders.userId, query.userId));
  if (query.dateFrom) conditions.push(gte(orders.placedAt, query.dateFrom));
  if (query.dateTo) conditions.push(lte(orders.placedAt, query.dateTo));
  if (query.q) conditions.push(ilike(orders.orderNumber, `%${query.q}%`));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // asc(id) tiebreaker on every branch, so a page cannot repeat or skip an order.
  const orderBy =
    query.sort === "oldest"
      ? [asc(orders.placedAt), asc(orders.id)]
      : query.sort === "total-desc"
        ? [desc(orders.total), asc(orders.id)]
        : query.sort === "total-asc"
          ? [asc(orders.total), asc(orders.id)]
          : [desc(orders.placedAt), asc(orders.id)];

  // Three queries for a whole page: the orders, their items, and the count folded into the
  // first. It was previously 1 + 2N — with pageSize capped at 100, an admin page could be 200
  // round trips, and adminDashboardService.summary inherited that for its recent-orders panel.
  const rows = await db
    .select({
      order: orders,
      buyer: buyerSelect,
      totalCount: sql<number>`count(*) over()::int`,
    })
    .from(orders)
    .innerJoin(users, eq(orders.userId, users.id))
    .where(whereClause)
    .orderBy(...orderBy)
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  const hydrated = await orderService.attachItems(rows.map((row) => row.order));
  const buyerByOrderId = new Map(rows.map((row) => [row.order.id, row.buyer]));

  return {
    items: hydrated.map((order) => ({ ...order, buyer: buyerByOrderId.get(order.id)! })),
    total: rows[0]?.totalCount ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getOrder(orderId: string) {
  const [row] = await db
    .select({ id: orders.id, buyer: buyerSelect })
    .from(orders)
    .innerJoin(users, eq(orders.userId, users.id))
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!row) throw new NotFoundError("Order");
  return withDetail(row.id, row.buyer);
}

export async function updateStatus(orderId: string, status: OrderStatus) {
  const [existing] = await db
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!existing) throw new NotFoundError("Order");

  await db.update(orders).set({ status }).where(eq(orders.id, orderId));

  await auditService.log({
    actorType: "admin",
    actorId: "admin",
    action: "order.status",
    decision: "approved",
    outcome: "success",
    metadata: { orderId, from: existing.status, to: status },
  });

  return getOrder(orderId);
}
