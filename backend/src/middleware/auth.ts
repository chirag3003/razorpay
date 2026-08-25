import type { MiddlewareHandler } from "hono";
import { UnauthorizedError } from "../errors";
import { verifyToken } from "../services/userService";
import type { AppEnv } from "../types";

// Human session auth for REST routes — verifies the Authorization: Bearer <jwt> header issued
// by userService.issueToken and sets userId on context. Root Hard Rule #5: "discovery is open,
// transacting is not" — this middleware is applied to every route except catalog browse and
// the Razorpay webhook.
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing bearer token");
  }

  const token = header.slice("Bearer ".length);
  const userId = await verifyToken(token);
  c.set("userId", userId);
  await next();
};
