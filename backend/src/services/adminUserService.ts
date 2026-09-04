import { asc, desc, ilike, or, sql } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import type { AdminUserQuery } from "../schemas/admin-user.schema";
import { splitPagedRows } from "../utils/paginate";

// Read-only. passwordHash is never selected.
export async function listUsers(query: AdminUserQuery) {
  const whereClause = query.q
    ? or(ilike(users.name, `%${query.q}%`), ilike(users.email, `%${query.q}%`))
    : undefined;

  // One query, not two — see splitPagedRows.
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      createdAt: users.createdAt,
      totalCount: sql<number>`count(*) over()::int`,
    })
    .from(users)
    .where(whereClause)
    // asc(users.id) for the same reason productService carries one: equal createdAt values would
    // otherwise come back in planner order, and a page could repeat or skip a user.
    .orderBy(desc(users.createdAt), asc(users.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    ...splitPagedRows(rows),
    page: query.page,
    pageSize: query.pageSize,
  };
}
