import { pgTable, uuid, text, integer, boolean, real } from "drizzle-orm/pg-core";
import { categories } from "./categories";

export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "restrict" }),
  price: integer("price").notNull(),
  mrp: integer("mrp").notNull(),
  unit: text("unit").notNull(),
  image: text("image").notNull(),
  images: text("images").array().notNull(),
  description: text("description").notNull(),
  rating: real("rating").notNull().default(0),
  ratingCount: integer("rating_count").notNull().default(0),
  inStock: boolean("in_stock").notNull().default(true),
  tags: text("tags").array().notNull().default([]),
});
