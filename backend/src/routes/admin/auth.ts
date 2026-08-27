import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { adminLoginSchema } from "../../schemas/admin-auth.schema";
import * as adminAuthService from "../../services/adminAuthService";
import type { AdminEnv } from "../../types";

// The one admin route with no requireAdmin — it's how you get a token in the first place.
export const adminAuthRoutes = new Hono<AdminEnv>();

adminAuthRoutes.post("/login", zValidator("json", adminLoginSchema), async (c) => {
  const { password } = c.req.valid("json");
  const token = await adminAuthService.login(password);
  return c.json({ token });
});
