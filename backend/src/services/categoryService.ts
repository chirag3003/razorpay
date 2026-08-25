import { eq } from "drizzle-orm";
import { db } from "../db";
import { categories } from "../db/schema";
import { NotFoundError } from "../errors";

export async function listCategories() {
  return db.select().from(categories).orderBy(categories.name);
}

export async function getCategoryBySlug(slug: string) {
  const [category] = await db
    .select()
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);

  if (!category) throw new NotFoundError("Category");
  return category;
}
