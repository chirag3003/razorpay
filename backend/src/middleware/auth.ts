import type { MiddlewareHandler } from "hono";
import { UnauthorizedError } from "../errors";
import { verifyToken } from "../services/userService";
import type { AppEnv } from "../types";

// Human session auth: verifies the bearer JWT from userService.issueToken and sets userId.
// Applied to every route except catalog browse and the Razorpay webhook (Hard Rule #5).
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
