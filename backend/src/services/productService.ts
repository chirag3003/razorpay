import { and, arrayContains, desc, asc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { categories, products } from "../db/schema";
import { NotFoundError } from "../errors";
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
  const conditions = [];

  if (filters.category.length > 0) {
    conditions.push(inArray(categories.slug, filters.category));
  }
  if (filters.q) {
    conditions.push(ilike(products.name, `%${filters.q}%`));
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

  const orderBy =
    filters.sort === "price-asc"
      ? [asc(products.price)]
      : filters.sort === "price-desc"
        ? [desc(products.price)]
        : filters.sort === "rating"
          ? [desc(products.rating)]
          : filters.sort === "newest"
            ? [sql`CASE WHEN ${products.tags} @> ARRAY['new']::text[] THEN 0 ELSE 1 END`]
            : [desc(products.ratingCount)];

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
    .where(eq(products.slug, slug))
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
      and(eq(categories.slug, product.categorySlug), sql`${products.id} != ${product.id}`)
    )
    .limit(limit);
}

export async function getProductById(id: string) {
  const [product] = await db
    .select(productWithCategory)
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.id, id))
    .limit(1);

  if (!product) throw new NotFoundError("Product");
  return product;
}
