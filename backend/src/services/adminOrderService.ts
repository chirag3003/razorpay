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

  const orderBy =
    query.sort === "oldest"
      ? [asc(orders.placedAt)]
      : query.sort === "total-desc"
        ? [desc(orders.total)]
        : query.sort === "total-asc"
          ? [asc(orders.total)]
          : [desc(orders.placedAt)];

  const [rows, countRows] = await Promise.all([
    db
      .select({ id: orders.id, buyer: buyerSelect })
      .from(orders)
      .innerJoin(users, eq(orders.userId, users.id))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(whereClause),
  ]);

  const items = await Promise.all(rows.map((r) => withDetail(r.id, r.buyer)));

  return {
    items,
    total: countRows[0]?.count ?? 0,
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
