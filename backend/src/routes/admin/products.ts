import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAdmin } from "../../middleware/adminAuth";
import {
  adminProductQuerySchema,
  createProductSchema,
  updateProductSchema,
} from "../../schemas/admin-product.schema";
import * as adminProductService from "../../services/adminProductService";
import type { AdminEnv } from "../../types";

export const adminProductRoutes = new Hono<AdminEnv>();

adminProductRoutes.use("*", requireAdmin);

adminProductRoutes.get(
  "/",
  zValidator("query", adminProductQuerySchema),
  async (c) => {
    return c.json(await adminProductService.list(c.req.valid("query")));
  }
);

adminProductRoutes.post(
  "/",
  zValidator("json", createProductSchema),
  async (c) => {
    const product = await adminProductService.create(c.req.valid("json"));
    return c.json({ product }, 201);
  }
);

adminProductRoutes.patch(
  "/:id",
  zValidator("json", updateProductSchema),
  async (c) => {
    const product = await adminProductService.update(
      c.req.param("id"),
      c.req.valid("json")
    );
    return c.json({ product });
  }
);

adminProductRoutes.delete("/:id", async (c) => {
  const result = await adminProductService.remove(c.req.param("id"));
  // Couldn't hard-delete (referenced by a past order) — it was archived instead.
  if (result.archived) {
    return c.json({ product: result.product, archived: true });
  }
  return c.body(null, 204);
});
