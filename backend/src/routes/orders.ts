import { Hono } from "hono";
import * as orderService from "../services/orderService";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const orderRoutes = new Hono<AppEnv>();

orderRoutes.use("*", requireAuth);

orderRoutes.get("/", async (c) => {
  const orders = await orderService.listOrders(c.get("userId"));
  return c.json({ orders });
});

orderRoutes.get("/:id", async (c) => {
  const order = await orderService.getOrderById(c.get("userId"), c.req.param("id"));
  return c.json({ order });
});
