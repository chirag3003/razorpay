import type { MiddlewareHandler } from "hono";
import { UnauthorizedError } from "../errors";
import { verifyAdminToken } from "../services/adminAuthService";
import type { AdminEnv } from "../types";

// Verifies the bearer JWT from POST /api/admin/login. Separate from middleware/auth.ts:
// different secret, different claim, never sets `userId`.
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
