import { desc, ilike, or, sql } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import type { AdminUserQuery } from "../schemas/admin-user.schema";

// Read-only. passwordHash is never selected.
export async function listUsers(query: AdminUserQuery) {
  const whereClause = query.q
    ? or(ilike(users.name, `%${query.q}%`), ilike(users.email, `%${query.q}%`))
    : undefined;

  const [items, countRows] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(whereClause)
      .orderBy(desc(users.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(whereClause),
  ]);

  return {
    items,
    total: countRows[0]?.count ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}
