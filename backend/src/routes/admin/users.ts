import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAdmin } from "../../middleware/adminAuth";
import { adminUserQuerySchema } from "../../schemas/admin-user.schema";
import * as adminUserService from "../../services/adminUserService";
import type { AdminEnv } from "../../types";

export const adminUserRoutes = new Hono<AdminEnv>();

adminUserRoutes.use("*", requireAdmin);

adminUserRoutes.get("/", zValidator("query", adminUserQuerySchema), async (c) => {
  return c.json(await adminUserService.listUsers(c.req.valid("query")));
});
