import { z } from "zod";

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
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
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
