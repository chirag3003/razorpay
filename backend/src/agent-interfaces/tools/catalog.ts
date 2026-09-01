import * as categoryService from "../../services/categoryService";
import * as productService from "../../services/productService";
import * as searchAssistService from "../../services/searchAssistService";
import {
  getProductSchema,
  emptySchema,
  relatedProductsSchema,
  searchProductsSchema,
  searchProductsNlSchema,
} from "../../schemas/agent-tool.schema";
import { toAgentProduct, toAgentProductDetail } from "./presenters";
import { defineTool } from "./types";

// Discovery tools. Read-only — per Hard Rule #5 these are the ones that would stay
// unauthenticated if the tool layer ever gets a public surface.

const searchProducts = defineTool({
  name: "search_products",
  description:
    "Search the store catalog. Returns compact product records (id, slug, name, unit, price, " +
    "mrp, image, inStock). Use the id or slug with add_to_cart. Search covers product names and " +
    "tags only — for a vague request, call list_categories first and filter by category rather " +
    "than guessing keywords.",
  input: searchProductsSchema,
  readOnly: true,
  handler: async (_ctx, input) => {
    const result = await productService.listProducts({
      q: input.q ?? "",
      category: input.category ?? [],
      tag: input.tag ?? [],
      minPrice: input.minPrice,
      maxPrice: input.maxPrice,
      // productService only applies this filter when truthy — there is no "out of stock only".
      inStock: input.inStockOnly ?? false,
      sort: input.sort ?? "popularity",
      page: 1,
      pageSize: input.limit,
    });

    return {
      products: result.items.map(toAgentProduct),
      total: result.total,
      // Explicit rather than inferred from total vs length — otherwise the model offers to
      // "show more" when there is nothing more.
      hasMore: result.total > result.items.length,
    };
  },
});

// For MCP callers with no LLM of their own. search_products stays LLM-free — this is a separate
// tool one layer above it, and per LLM Isolation only this handler may reach searchAssistService.
const searchProductsNl = defineTool({
  name: "search_products_nl",
  description:
    "Search the catalog from a free-text description of what the customer wants (an LLM turns " +
    "it into structured filters first). Prefer search_products if you already know exact " +
    "keywords, a category slug, or specific tags — this tool is for vague, natural-language " +
    "requests only.",
  input: searchProductsNlSchema,
  readOnly: true,
  handler: async (_ctx, input) => {
    const filters = await searchAssistService.buildSearchFiltersFromText(input.query);

    const result = await productService.listProducts({
      q: filters.category || filters.tag ? "" : input.query,
      category: filters.category ?? [],
      tag: filters.tag ?? [],
      minPrice: filters.minPrice,
      maxPrice: filters.maxPrice,
      inStock: false,
      sort: filters.sort ?? "popularity",
      page: 1,
      pageSize: 6,
    });

    return {
      products: result.items.map(toAgentProduct),
      total: result.total,
      hasMore: result.total > result.items.length,
    };
  },
});

const getProduct = defineTool({
  name: "get_product",
  description:
    "Full detail for one product, including its category and tags. Accepts either a slug or an " +
    "id. Use when the customer asks about a specific item you already found.",
  input: getProductSchema,
  readOnly: true,
  handler: async (_ctx, input) => {
    // Ids are UUIDs, anything else is a slug — so the model need not know which it holds.
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.slugOrId);

    const product = isUuid
      ? await productService.getProductById(input.slugOrId)
      : await productService.getProductBySlug(input.slugOrId);

    return { product: toAgentProductDetail(product) };
  },
});

const listCategories = defineTool({
  name: "list_categories",
  description:
    "List every category in the store. Call this when the customer's request is vague " +
    '("something sweet", "snacks") — pick the closest category and pass its slug to ' +
    "search_products, which is more reliable than guessing search keywords.",
  input: emptySchema,
  readOnly: true,
  handler: async () => {
    const categories = await categoryService.listCategories();
    return {
      categories: categories.map((category) => ({
        slug: category.slug,
        name: category.name,
        description: category.description,
      })),
    };
  },
});

const listRelatedProducts = defineTool({
  name: "list_related_products",
  description:
    "Other products in the same category as the given one. These are related, not ranked " +
    "recommendations — the order is arbitrary. Useful for offering alternatives when something " +
    "is out of stock.",
  input: relatedProductsSchema,
  readOnly: true,
  handler: async (_ctx, input) => {
    const products = await productService.getRelatedProducts(input.slug, input.limit);
    return { products: products.map(toAgentProduct) };
  },
});

export const catalogTools = [
  searchProducts,
  searchProductsNl,
  getProduct,
  listCategories,
  listRelatedProducts,
];
