import { Hono } from "hono";
import { requireAdmin } from "../../middleware/adminAuth";
import * as adminDashboardService from "../../services/adminDashboardService";
import type { AdminEnv } from "../../types";

export const adminDashboardRoutes = new Hono<AdminEnv>();

adminDashboardRoutes.use("*", requireAdmin);

adminDashboardRoutes.get("/", async (c) => {
  return c.json(await adminDashboardService.summary());
});
