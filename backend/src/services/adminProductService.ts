import { and, asc, desc, eq, ilike, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { categories, products } from "../db/schema";
import { ConflictError, NotFoundError } from "../errors";
import * as auditService from "./auditService";
import * as categoryService from "./categoryService";
import { slugify } from "../utils/slug";
import { splitPagedRows } from "../utils/paginate";
import {
  pgErrorCode,
  PG_UNIQUE_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
} from "../utils/db-error";
import type {
  AdminProductQuery,
  CreateProductInput,
  UpdateProductInput,
} from "../schemas/admin-product.schema";

// productService's `productWithCategory` plus `archivedAt` — the admin surface sees archived rows.
const adminProductSelect = {
  id: products.id,
  slug: products.slug,
  name: products.name,
  categorySlug: categories.slug,
  price: products.price,
  mrp: products.mrp,
  unit: products.unit,
  image: products.image,
  images: products.images,
  description: products.description,
  rating: products.rating,
  ratingCount: products.ratingCount,
  inStock: products.inStock,
  tags: products.tags,
  archivedAt: products.archivedAt,
};

async function getAdminProductById(id: string) {
  const [product] = await db
    .select(adminProductSelect)
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.id, id))
    .limit(1);

  if (!product) throw new NotFoundError("Product");
  return product;
}

// First free slug of the form base, base-2, base-3. The unique index is the real backstop,
// caught below.
async function uniqueProductSlug(name: string) {
  const base = slugify(name) || "product";
  let candidate = base;
  let n = 2;

  while (true) {
    const [hit] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.slug, candidate))
      .limit(1);
    if (!hit) return candidate;
    candidate = `${base}-${n}`;
    n += 1;
  }
}

export async function list(query: AdminProductQuery) {
  const conditions = [];

  if (query.q) conditions.push(ilike(products.name, `%${query.q}%`));
  if (query.category) conditions.push(eq(categories.slug, query.category));
  if (query.archived === "exclude") conditions.push(isNull(products.archivedAt));
  if (query.archived === "only") conditions.push(isNotNull(products.archivedAt));
  if (query.inStock === "true") conditions.push(eq(products.inStock, true));
  if (query.inStock === "false") conditions.push(eq(products.inStock, false));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const orderBy =
    query.sort === "name-asc"
      ? [asc(products.name), asc(products.id)]
      : query.sort === "price-asc"
        ? [asc(products.price), asc(products.id)]
        : query.sort === "price-desc"
          ? [desc(products.price), asc(products.id)]
          : [desc(products.createdAt), asc(products.id)]; // "newest"

  // One query, not two — see splitPagedRows.
  const rows = await db
    .select({ ...adminProductSelect, totalCount: sql<number>`count(*) over()::int` })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(whereClause)
    .orderBy(...orderBy)
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    ...splitPagedRows(rows),
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function create(input: CreateProductInput) {
  const category = await categoryService.getCategoryBySlug(input.categorySlug);
  const slug = await uniqueProductSlug(input.name);

  let created;
  try {
    [created] = await db
      .insert(products)
      .values({
        slug,
        name: input.name,
        categoryId: category.id,
        price: input.price,
        mrp: input.mrp,
        unit: input.unit,
        image: input.image,
        images: input.images ?? [input.image],
        description: input.description,
        inStock: input.inStock ?? true,
        tags: input.tags ?? [],
      })
      .returning({ id: products.id });
  } catch (err) {
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
      throw new ConflictError("A product with this slug already exists");
    }
    throw err;
  }

  if (!created) throw new Error("Failed to create product");

  const product = await getAdminProductById(created.id);
  await auditService.log({
    actorType: "admin",
    actorId: "admin",
    action: "product.create",
    decision: "approved",
    outcome: "success",
    metadata: { productId: product.id, slug: product.slug },
  });
  return product;
}

export async function update(id: string, input: UpdateProductInput) {
  await getAdminProductById(id);

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.price !== undefined) patch.price = input.price;
  if (input.mrp !== undefined) patch.mrp = input.mrp;
  if (input.unit !== undefined) patch.unit = input.unit;
  if (input.image !== undefined) patch.image = input.image;
  if (input.images !== undefined) patch.images = input.images;
  if (input.description !== undefined) patch.description = input.description;
  if (input.inStock !== undefined) patch.inStock = input.inStock;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.categorySlug !== undefined) {
    const category = await categoryService.getCategoryBySlug(input.categorySlug);
    patch.categoryId = category.id;
  }
  if (input.archived !== undefined) {
    patch.archivedAt = input.archived ? new Date() : null;
  }

  if (Object.keys(patch).length > 0) {
    await db.update(products).set(patch).where(eq(products.id, id));
  }

  const product = await getAdminProductById(id);
  await auditService.log({
    actorType: "admin",
    actorId: "admin",
    action: "product.update",
    decision: "approved",
    outcome: "success",
    metadata: { productId: id, fields: Object.keys(patch) },
  });
  return product;
}

// Hard-delete unless a past order references it (order_items FK is onDelete "restrict"), in
// which case archive instead.
export async function remove(id: string) {
  await getAdminProductById(id);

  try {
    await db.delete(products).where(eq(products.id, id));
  } catch (err) {
    if (pgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION) {
      await db
        .update(products)
        .set({ archivedAt: new Date() })
        .where(eq(products.id, id));
      const product = await getAdminProductById(id);
      await auditService.log({
        actorType: "admin",
        actorId: "admin",
        action: "product.archive",
        decision: "approved",
        outcome: "success",
        metadata: { productId: id, reason: "referenced_by_orders" },
      });
      return { product, archived: true as const };
    }
    throw err;
  }

  await auditService.log({
    actorType: "admin",
    actorId: "admin",
    action: "product.delete",
    decision: "approved",
    outcome: "success",
    metadata: { productId: id },
  });
  return { product: null, archived: false as const };
}
