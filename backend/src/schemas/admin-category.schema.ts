import { z } from "zod";

export const createCategorySchema = z.object({
  name: z.string().min(2, "Enter a category name"),
  description: z.string().min(1, "Enter a description"),
  icon: z.string().min(1, "Enter a Lucide icon name, e.g. \"Carrot\""),
  image: z.url("Enter a valid image URL"),
  // Optional — derived from `name` when omitted.
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase-kebab-case")
    .optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = createCategorySchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update",
  });

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
