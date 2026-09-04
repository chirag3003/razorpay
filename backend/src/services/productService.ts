import {
  and,
  arrayContains,
  desc,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import { db } from "../db";
import { categories, products } from "../db/schema";
import { NotFoundError } from "../errors";
import { buildProductSearchCondition } from "./productSearch";
import type { ProductQuery } from "../schemas/product-query.schema";

// Returned shape mirrors the frontend's Product type (categorySlug, not a raw categoryId FK).
const productWithCategory = {
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
};

export async function listProducts(filters: ProductQuery) {
  // Archived products are never part of the storefront catalog.
  const conditions = [isNull(products.archivedAt)];

  if (filters.category.length > 0) {
    conditions.push(inArray(categories.slug, filters.category));
  }
  if (filters.q) {
    // Matching strategy lives in productSearch.ts — one swap point for both the storefront and
    // the agent tools, so the two can never diverge on what "search" means.
    const search = buildProductSearchCondition(filters.q);
    if (search) conditions.push(search);
  }
  if (filters.tag.length > 0) {
    conditions.push(arrayContains(products.tags, filters.tag));
  }
  if (typeof filters.minPrice === "number") {
    conditions.push(gte(products.price, filters.minPrice));
  }
  if (typeof filters.maxPrice === "number") {
    conditions.push(lte(products.price, filters.maxPrice));
  }
  if (filters.inStock) {
    conditions.push(eq(products.inStock, true));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Every sort ends with products.id. Without a tiebreaker, rows with equal keys come back in
  // planner order, which is not stable across pages — so paginated results could repeat or skip
  // products entirely. That is the backend half of web/issues.md's pagination bug.
  const orderBy =
    filters.sort === "price-asc"
      ? [asc(products.price), asc(products.id)]
      : filters.sort === "price-desc"
        ? [desc(products.price), asc(products.id)]
        : filters.sort === "rating"
          ? [desc(products.rating), asc(products.id)]
          : filters.sort === "newest"
            ? // Actually by age now. This used to order by whether the product carried the `new`
              // *tag*, because products had no created_at column.
              [desc(products.createdAt), asc(products.id)]
            : [desc(products.ratingCount), asc(products.id)];

  const baseQuery = db
    .select(productWithCategory)
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id));

  const filtered = whereClause ? baseQuery.where(whereClause) : baseQuery;

  const [items, countRows] = await Promise.all([
    filtered
      .orderBy(...orderBy)
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(products)
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .where(whereClause),
  ]);

  return {
    items,
    total: countRows[0]?.count ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

export async function getProductBySlug(slug: string) {
  const [product] = await db
    .select(productWithCategory)
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.slug, slug), isNull(products.archivedAt)))
    .limit(1);

  if (!product) throw new NotFoundError("Product");
  return product;
}

export async function getRelatedProducts(slug: string, limit = 5) {
  const product = await getProductBySlug(slug);

  return db
    .select(productWithCategory)
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        eq(categories.slug, product.categorySlug),
        sql`${products.id} != ${product.id}`,
        isNull(products.archivedAt)
      )
    )
    .limit(limit);
}

export async function getProductById(id: string) {
  const [product] = await db
    .select(productWithCategory)
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.id, id), isNull(products.archivedAt)))
    .limit(1);

  if (!product) throw new NotFoundError("Product");
  return product;
}
