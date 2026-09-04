import { z } from "zod";
import { MAX_PRODUCT_PRICE } from "../constants";

const commaList = z
  .string()
  .optional()
  .transform((value) =>
    value
      ? value
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      : []
  );

export const productQuerySchema = z.object({
  category: commaList,
  tag: commaList,
  q: z.string().optional().default(""),
  // Bounded, not just coerced. products.price is a Postgres integer, so an unbounded value
  // reaches `lte(products.price, …)` and fails as "integer out of range" — not a DomainError, so
  // it escapes as a bare 500 on the most public endpoint in the app. Same ceiling
  // agent-tool.schema.ts already applies to the same two filters.
  minPrice: z.coerce.number().int().nonnegative().max(MAX_PRODUCT_PRICE).optional(),
  maxPrice: z.coerce.number().int().nonnegative().max(MAX_PRODUCT_PRICE).optional(),
  inStock: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  sort: z
    .enum(["popularity", "price-asc", "price-desc", "rating", "newest"])
    .optional()
    .default("popularity"),
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(50).optional().default(12),
});

export type ProductQuery = z.infer<typeof productQuerySchema>;
