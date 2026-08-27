import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAdmin } from "../../middleware/adminAuth";
import {
  adminOrderQuerySchema,
  updateOrderStatusSchema,
} from "../../schemas/admin-order.schema";
import * as adminOrderService from "../../services/adminOrderService";
import type { AdminEnv } from "../../types";

export const adminOrderRoutes = new Hono<AdminEnv>();

adminOrderRoutes.use("*", requireAdmin);

adminOrderRoutes.get(
  "/",
  zValidator("query", adminOrderQuerySchema),
  async (c) => {
    return c.json(await adminOrderService.listOrders(c.req.valid("query")));
  }
);

adminOrderRoutes.get("/:id", async (c) => {
  const order = await adminOrderService.getOrder(c.req.param("id"));
  return c.json({ order });
});

adminOrderRoutes.patch(
  "/:id/status",
  zValidator("json", updateOrderStatusSchema),
  async (c) => {
    const order = await adminOrderService.updateStatus(
      c.req.param("id"),
      c.req.valid("json").status
    );
    return c.json({ order });
  }
);
