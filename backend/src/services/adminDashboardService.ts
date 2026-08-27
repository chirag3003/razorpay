import { and, eq, gte, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { categories, orders, products, users } from "../db/schema";
import { ORDER_STATUSES } from "../constants";
import * as adminOrderService from "./adminOrderService";

const int = sql<number>`count(*)::int`;

export async function summary() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    ordersTotal,
    statusRows,
    revenueAll,
    revenue30,
    productsActive,
    productsArchived,
    outOfStock,
    categoriesTotal,
    usersTotal,
    recent,
  ] = await Promise.all([
    db.select({ c: int }).from(orders),
    db
      .select({ status: orders.status, c: int })
      .from(orders)
      .groupBy(orders.status),
    db
      .select({ s: sql<number>`coalesce(sum(${orders.total}), 0)::int` })
      .from(orders)
      .where(ne(orders.status, "cancelled")),
    db
      .select({ s: sql<number>`coalesce(sum(${orders.total}), 0)::int` })
      .from(orders)
      .where(
        and(ne(orders.status, "cancelled"), gte(orders.placedAt, thirtyDaysAgo))
      ),
    db.select({ c: int }).from(products).where(isNull(products.archivedAt)),
    db.select({ c: int }).from(products).where(isNotNull(products.archivedAt)),
    db
      .select({ c: int })
      .from(products)
      .where(and(isNull(products.archivedAt), eq(products.inStock, false))),
    db.select({ c: int }).from(categories),
    db.select({ c: int }).from(users),
    adminOrderService.listOrders({
      q: "",
      sort: "newest",
      page: 1,
      pageSize: 10,
    }),
  ]);

  const byStatus: Record<string, number> = Object.fromEntries(
    ORDER_STATUSES.map((s) => [s, 0])
  );
  for (const row of statusRows) byStatus[row.status] = row.c;

  return {
    orders: { total: ordersTotal[0]?.c ?? 0, byStatus },
    revenue: {
      allTime: revenueAll[0]?.s ?? 0,
      last30Days: revenue30[0]?.s ?? 0,
    },
    catalog: {
      products: productsActive[0]?.c ?? 0,
      archived: productsArchived[0]?.c ?? 0,
      categories: categoriesTotal[0]?.c ?? 0,
      outOfStock: outOfStock[0]?.c ?? 0,
    },
    users: { total: usersTotal[0]?.c ?? 0 },
    recentOrders: recent.items,
  };
}
