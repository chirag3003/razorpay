import * as categoryService from "../../services/categoryService";
import * as productService from "../../services/productService";
import {
  getProductSchema,
  emptySchema,
  relatedProductsSchema,
  searchProductsSchema,
} from "../../schemas/agent-tool.schema";
import { toAgentProduct, toAgentProductDetail } from "./presenters";
import { defineTool } from "./types";

// Discovery tools. Read-only, and per root Hard Rule #5 ("discovery is open, transacting is not")
// these are the ones that would stay unauthenticated if the tool layer ever gets a public surface.

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
      // Told explicitly rather than left for the model to infer from total vs length — it will
      // otherwise offer to "show more" when there is nothing more.
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
    // Ids are UUIDs; anything else is a slug. Trying both saves the model from having to know
    // which identifier it happens to be holding.
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
  getProduct,
  listCategories,
  listRelatedProducts,
];
