import type { MiddlewareHandler } from "hono";
import { UnauthorizedError } from "../errors";
import { verifyAdminToken } from "../services/adminAuthService";
import type { AdminEnv } from "../types";

// Admin surface auth for the /api/admin routes — verifies the Authorization: Bearer <jwt>
// header issued by POST /api/admin/login (adminAuthService.login). Entirely separate from
// middleware/auth.ts: different secret, different claim, and it never sets `userId`.
export const requireAdmin: MiddlewareHandler<AdminEnv> = async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing admin bearer token");
  }

  const token = header.slice("Bearer ".length);
  await verifyAdminToken(token);
  c.set("admin", true);
  await next();
};
