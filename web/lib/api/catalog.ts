import { apiFetch, ApiError } from "@/lib/api/client";
import type { Category, Product, SortOption } from "@/lib/types";

export type ProductFilters = {
  categorySlugs?: string[];
  query?: string;
  minPrice?: number;
  maxPrice?: number;
  tags?: string[];
  inStockOnly?: boolean;
  sort?: SortOption;
  page?: number;
  pageSize?: number;
};

export type ProductPage = {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
};

async function notFoundToNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof ApiError && err.code === "NOT_FOUND") return null;
    throw err;
  }
}

export async function getCategories(): Promise<Category[]> {
  const { categories } = await apiFetch<{ categories: Category[] }>(
    "/api/categories"
  );
  return categories;
}

export function getCategoryBySlug(slug: string): Promise<Category | null> {
  return notFoundToNull(
    apiFetch<{ category: Category }>(`/api/categories/${slug}`).then(
      (res) => res.category
    )
  );
}

export async function getProducts(
  filters: ProductFilters = {}
): Promise<ProductPage> {
  const {
    categorySlugs,
    query,
    minPrice,
    maxPrice,
    tags,
    inStockOnly,
    sort,
    page,
    pageSize,
  } = filters;

  return apiFetch<ProductPage>("/api/products", {
    searchParams: {
      category: categorySlugs?.length ? categorySlugs.join(",") : undefined,
      tag: tags?.length ? tags.join(",") : undefined,
      q: query || undefined,
      minPrice,
      maxPrice,
      inStock: inStockOnly ? "true" : undefined,
      sort,
      page,
      pageSize,
    },
  });
}

export function getProductBySlug(slug: string): Promise<Product | null> {
  return notFoundToNull(
    apiFetch<{ product: Product }>(`/api/products/${slug}`).then(
      (res) => res.product
    )
  );
}

export async function getRelatedProducts(
  slug: string,
  limit = 5
): Promise<Product[]> {
  const { products } = await apiFetch<{ products: Product[] }>(
    `/api/products/${slug}/related`
  );
  return products.slice(0, limit);
}

export async function getFeaturedProducts(limit = 8): Promise<Product[]> {
  const { items } = await getProducts({
    tags: ["bestseller"],
    pageSize: limit,
    sort: "popularity",
  });
  return items;
}

export async function getNewArrivals(limit = 8): Promise<Product[]> {
  const { items } = await getProducts({
    tags: ["new"],
    pageSize: limit,
    sort: "newest",
  });
  return items;
}

export async function searchProducts(
  query: string,
  limit = 6
): Promise<Product[]> {
  if (!query.trim()) return [];
  const { items } = await getProducts({ query, pageSize: limit });
  return items;
}
