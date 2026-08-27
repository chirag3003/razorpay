import { z } from "zod";

// Fields an admin supplies when creating a product. `slug` is derived from `name`;
// `rating`/`ratingCount` are review-driven and start at 0; `archivedAt` is managed by the
// delete/archive flow. `categorySlug` is resolved to the FK server-side.
export const createProductSchema = z.object({
  name: z.string().min(2, "Enter a product name"),
  categorySlug: z.string().min(1, "categorySlug is required"),
  price: z.number().int().positive("price must be a positive integer (whole rupees)"),
  mrp: z.number().int().positive("mrp must be a positive integer (whole rupees)"),
  unit: z.string().min(1, "Enter a unit, e.g. \"1 kg\""),
  image: z.url("Enter a valid image URL"),
  images: z.array(z.url("Each image must be a valid URL")).optional(),
  description: z.string().min(1, "Enter a description"),
  inStock: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

// Any subset of the create fields, plus an `archived` toggle (true -> stamp archivedAt,
// false -> clear it). At least one key must be present.
export const updateProductSchema = createProductSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update",
  });

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

// Admin catalog listing — no implicit in-stock/archived filtering (that's the storefront's job).
export const adminProductQuerySchema = z.object({
  q: z.string().optional().default(""),
  category: z.string().optional(),
  archived: z.enum(["exclude", "only", "all"]).optional().default("exclude"),
  inStock: z.enum(["true", "false"]).optional(),
  sort: z
    .enum(["newest", "name-asc", "price-asc", "price-desc"])
    .optional()
    .default("newest"),
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
});

export type AdminProductQuery = z.infer<typeof adminProductQuerySchema>;
