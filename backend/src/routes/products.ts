import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { productQuerySchema } from "../schemas/product-query.schema";
import * as productService from "../services/productService";
import type { AppEnv } from "../types";

export const productRoutes = new Hono<AppEnv>();

productRoutes.get("/", zValidator("query", productQuerySchema), async (c) => {
  const filters = c.req.valid("query");
  const result = await productService.listProducts(filters);
  return c.json(result);
});

productRoutes.get("/:slug", async (c) => {
  const product = await productService.getProductBySlug(c.req.param("slug"));
  return c.json({ product });
});

productRoutes.get("/:slug/related", async (c) => {
  const products = await productService.getRelatedProducts(c.req.param("slug"));
  return c.json({ products });
});
