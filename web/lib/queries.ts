import { categories } from "@/data/categories";
import { products } from "@/data/products";
import { orders, addresses } from "@/data/orders";
import type { Product, SortOption } from "@/lib/types";

export type ProductFilters = {
  categorySlugs?: string[];
  query?: string;
  minPrice?: number;
  maxPrice?: number;
  tags?: string[];
  inStockOnly?: boolean;
  sort?: SortOption;
};

export function getCategories() {
  return categories;
}

export function getCategoryBySlug(slug: string) {
  return categories.find((category) => category.slug === slug);
}

function sortProducts(list: Product[], sort?: SortOption) {
  const sorted = [...list];
  switch (sort) {
    case "price-asc":
      return sorted.sort((a, b) => a.price - b.price);
    case "price-desc":
      return sorted.sort((a, b) => b.price - a.price);
    case "rating":
      return sorted.sort((a, b) => b.rating - a.rating);
    case "newest":
      return sorted.sort(
        (a, b) => Number(b.tags.includes("new")) - Number(a.tags.includes("new"))
      );
    case "popularity":
    default:
      return sorted.sort((a, b) => b.ratingCount - a.ratingCount);
  }
}

export function getProducts(filters: ProductFilters = {}) {
  const { categorySlugs, query, minPrice, maxPrice, tags, inStockOnly, sort } =
    filters;

  let result = products;

  if (categorySlugs && categorySlugs.length > 0) {
    result = result.filter((product) =>
      categorySlugs.includes(product.categorySlug)
    );
  }

  if (query && query.trim().length > 0) {
    const q = query.trim().toLowerCase();
    result = result.filter((product) =>
      product.name.toLowerCase().includes(q)
    );
  }

  if (typeof minPrice === "number") {
    result = result.filter((product) => product.price >= minPrice);
  }

  if (typeof maxPrice === "number") {
    result = result.filter((product) => product.price <= maxPrice);
  }

  if (tags && tags.length > 0) {
    result = result.filter((product) =>
      tags.every((tag) => product.tags.includes(tag))
    );
  }

  if (inStockOnly) {
    result = result.filter((product) => product.inStock);
  }

  return sortProducts(result, sort);
}

export function getProductBySlug(slug: string) {
  return products.find((product) => product.slug === slug);
}

export function getProductById(id: string) {
  return products.find((product) => product.id === id);
}

export function getFeaturedProducts(limit = 8) {
  return products
    .filter((product) => product.tags.includes("bestseller"))
    .slice(0, limit);
}

export function getNewArrivals(limit = 8) {
  return products.filter((product) => product.tags.includes("new")).slice(0, limit);
}

export function getRelatedProducts(product: Product, limit = 4) {
  return products
    .filter(
      (item) =>
        item.categorySlug === product.categorySlug && item.id !== product.id
    )
    .slice(0, limit);
}

export function searchProducts(query: string, limit = 6) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return products
    .filter((product) => product.name.toLowerCase().includes(q))
    .slice(0, limit);
}

export function getOrders() {
  return [...orders].sort(
    (a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime()
  );
}

export function getOrderById(id: string) {
  return orders.find((order) => order.id === id);
}

export function getAddresses() {
  return addresses;
}
