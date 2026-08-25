import { Hono } from "hono";
import * as categoryService from "../services/categoryService";
import type { AppEnv } from "../types";

export const categoryRoutes = new Hono<AppEnv>();

categoryRoutes.get("/", async (c) => {
  const categories = await categoryService.listCategories();
  return c.json({ categories });
});

categoryRoutes.get("/:slug", async (c) => {
  const category = await categoryService.getCategoryBySlug(c.req.param("slug"));
  return c.json({ category });
});
