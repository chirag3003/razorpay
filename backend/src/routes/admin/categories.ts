import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAdmin } from "../../middleware/adminAuth";
import {
  createCategorySchema,
  updateCategorySchema,
} from "../../schemas/admin-category.schema";
import * as adminCategoryService from "../../services/adminCategoryService";
import type { AdminEnv } from "../../types";

export const adminCategoryRoutes = new Hono<AdminEnv>();

adminCategoryRoutes.use("*", requireAdmin);

adminCategoryRoutes.get("/", async (c) => {
  return c.json({ categories: await adminCategoryService.listWithCounts() });
});

adminCategoryRoutes.post(
  "/",
  zValidator("json", createCategorySchema),
  async (c) => {
    const category = await adminCategoryService.create(c.req.valid("json"));
    return c.json({ category }, 201);
  }
);

adminCategoryRoutes.patch(
  "/:id",
  zValidator("json", updateCategorySchema),
  async (c) => {
    const category = await adminCategoryService.update(
      c.req.param("id"),
      c.req.valid("json")
    );
    return c.json({ category });
  }
);

adminCategoryRoutes.delete("/:id", async (c) => {
  await adminCategoryService.remove(c.req.param("id"));
  return c.body(null, 204);
});
