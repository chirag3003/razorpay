import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { categories, products } from "../db/schema";
import { ConflictError, NotFoundError } from "../errors";
import * as auditService from "./auditService";
import * as categoryService from "./categoryService";
import { slugify } from "../utils/slug";
import {
  pgErrorCode,
  PG_UNIQUE_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
} from "../utils/db-error";
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from "../schemas/admin-category.schema";

export async function listWithCounts() {
  return db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      description: categories.description,
      icon: categories.icon,
      image: categories.image,
      productCount: sql<number>`count(${products.id})::int`,
    })
    .from(categories)
    .leftJoin(products, eq(products.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(categories.name);
}

async function assertSlugFree(slug: string, exceptId?: string) {
  const [hit] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);
  if (hit && hit.id !== exceptId) {
    throw new ConflictError("A category with this slug already exists");
  }
}

export async function create(input: CreateCategoryInput) {
  const slug = input.slug ?? slugify(input.name);
  await assertSlugFree(slug);

  let created;
  try {
    [created] = await db
      .insert(categories)
      .values({
        slug,
        name: input.name,
        description: input.description,
        icon: input.icon,
        image: input.image,
      })
      .returning();
  } catch (err) {
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
      throw new ConflictError("A category with this slug already exists");
    }
    throw err;
  }

  if (!created) throw new Error("Failed to create category");

  await auditService.log({
    actorType: "admin",
    actorId: "admin",
    action: "category.create",
    decision: "approved",
    outcome: "success",
    metadata: { categoryId: created.id, slug: created.slug },
  });
  return created;
}

export async function update(id: string, input: UpdateCategoryInput) {
  await categoryService.getCategoryById(id);

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.image !== undefined) patch.image = input.image;
  if (input.slug !== undefined) {
    await assertSlugFree(input.slug, id);
    patch.slug = input.slug;
  }

  const [updated] = await db
    .update(categories)
    .set(patch)
    .where(eq(categories.id, id))
    .returning();

  if (!updated) throw new NotFoundError("Category");

  await auditService.log({
    actorType: "admin",
    actorId: "admin",
    action: "category.update",
    decision: "approved",
    outcome: "success",
    metadata: { categoryId: id, fields: Object.keys(patch) },
  });
  return updated;
}

// Categories are hard-delete only. products.categoryId FK is onDelete: "restrict", so a
// category that still has products raises Postgres 23503 -> surfaced as 409.
export async function remove(id: string) {
  await categoryService.getCategoryById(id);

  try {
    await db.delete(categories).where(eq(categories.id, id));
  } catch (err) {
    if (pgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION) {
      throw new ConflictError(
        "Category still has products — reassign or delete them first"
      );
    }
    throw err;
  }

  await auditService.log({
    actorType: "admin",
    actorId: "admin",
    action: "category.delete",
    decision: "approved",
    outcome: "success",
    metadata: { categoryId: id },
  });
}
