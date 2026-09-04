import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import * as orderService from "../services/orderService";
import { listOrdersQuerySchema } from "../schemas/order-query.schema";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const orderRoutes = new Hono<AppEnv>();

orderRoutes.use("*", requireAuth);

// `orders` stays the array the storefront already reads; `total` is additive, so a client can
// paginate with ?limit/?offset without the existing one changing behaviour.
orderRoutes.get("/", zValidator("query", listOrdersQuerySchema), async (c) => {
  const { limit, offset } = c.req.valid("query");
  const { items, total } = await orderService.listOrders(c.get("userId"), { limit, offset });
  return c.json({ orders: items, total });
});

orderRoutes.get("/:id", async (c) => {
  const order = await orderService.getOrderById(c.get("userId"), c.req.param("id"));
  return c.json({ order });
});
