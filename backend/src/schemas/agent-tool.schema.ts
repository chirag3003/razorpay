import { z } from "zod";
import {
  DELIVERY_SLOTS,
  MAX_CART_ITEM_QTY,
  MAX_PRODUCT_PRICE,
  RESERVE_PAY_MAX_AMOUNT,
  RESERVE_PAY_MAX_EXPIRY_DAYS,
} from "../constants";

// Zod inputs for the agent tools. Leaf module — imports only constants, so it is importable
// anywhere with no cycle risk.
//
// These double as the tools' JSON schemas via z.toJSONSchema, so `.describe()` is not a comment:
// it is the parameter documentation a model reads before calling. Write it for the model.
//
// Shaped differently from product-query.schema.ts, which parses an HTTP query string (`category`
// a comma-joined string, `inStock` a "true"/"false" enum). Tools take the natural types a model
// sends — arrays and booleans — and the handler adapts.

const slotIds = DELIVERY_SLOTS.map((slot) => slot.id) as [string, ...string[]];

export const searchProductsSchema = z.object({
  q: z
    .string()
    .trim()
    .optional()
    .describe(
      "Free-text query. Matches product names and tags, NOT descriptions. For a vague request " +
        'like "something sweet", do not guess keywords — call list_categories and filter by ' +
        "category instead."
    ),
  category: z
    .array(z.string())
    .optional()
    .describe("Category slugs from list_categories. Matches ANY of them (OR)."),
  tag: z
    .array(z.enum(["bestseller", "new", "organic", "seasonal"]))
    .optional()
    .describe(
      "Products must carry ALL listed tags (AND), unlike category which is ANY. The vocabulary " +
        "is exactly these four values."
    ),
  minPrice: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_PRODUCT_PRICE)
    .optional()
    .describe("Minimum price in rupees. Omit for no lower bound — do not pass 0 for that."),
  maxPrice: z
    .number()
    .int()
    .positive()
    .max(MAX_PRODUCT_PRICE)
    .optional()
    .describe("Maximum price in rupees. Omit for no upper bound — do not pass a huge number."),
  inStockOnly: z.boolean().optional().describe("Only return products currently in stock."),
  sort: z
    .enum(["popularity", "price-asc", "price-desc", "rating", "newest"])
    .optional()
    .describe("Defaults to popularity."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(6)
    .describe("How many products to return. Keep it small — chat shows at most 6."),
});

// The filters searchQueryBuilder.ts asks the LLM to derive from free text: a subset of
// searchProductsSchema minus q/limit/inStockOnly, which the caller supplies directly. Shared so
// the tool schema and the LLM's forced JSON output cannot drift.
export const searchFiltersSchema = z.object({
  category: z
    .array(z.string())
    .optional()
    .describe("Category slugs, from the provided list only. Omit if nothing clearly matches."),
  tag: z
    .array(z.enum(["bestseller", "new", "organic", "seasonal"]))
    .optional()
    .describe("Only from this exact vocabulary. Omit if the request doesn't imply any."),
  minPrice: z.number().int().nonnegative().max(MAX_PRODUCT_PRICE).optional(),
  maxPrice: z.number().int().positive().max(MAX_PRODUCT_PRICE).optional(),
  sort: z.enum(["popularity", "price-asc", "price-desc", "rating", "newest"]).optional(),
});

export type SearchFilters = z.infer<typeof searchFiltersSchema>;

export const searchProductsNlSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .describe(
      "A free-text description of what the customer wants, in their own words (e.g. " +
        '"something sweet and cold for a party"). An LLM turns this into structured catalog ' +
        "filters — use search_products instead if you already know exact keywords/category/tags."
    ),
});

export const getProductSchema = z.object({
  slugOrId: z
    .string()
    .min(1)
    .describe("Either the product slug or its id, both of which search_products returns."),
});

export const relatedProductsSchema = z.object({
  slug: z.string().min(1).describe("Slug of the product to find alternatives to."),
  limit: z.number().int().min(1).max(10).default(4),
});

export const addToCartSchema = z
  .object({
    productId: z.string().uuid().optional().describe("Product id from search_products."),
    slug: z.string().min(1).optional().describe("Product slug, if you don't have the id."),
    qty: z
      .number()
      .int()
      .min(1)
      .max(MAX_CART_ITEM_QTY)
      .default(1)
      .describe(
        "Quantity to ADD. This is additive: calling twice with qty 1 leaves 2 in the cart. To " +
          "set an absolute quantity, use update_cart_item."
      ),
  })
  .refine((input) => Boolean(input.productId || input.slug), {
    message: "Provide either productId or slug",
  });

export const updateCartItemSchema = z.object({
  itemId: z.string().uuid().describe("The line's itemId from get_cart, not the product id."),
  qty: z
    .number()
    .int()
    .min(1)
    .max(MAX_CART_ITEM_QTY)
    .describe("The new absolute quantity. To remove the line entirely use remove_from_cart."),
});

export const removeFromCartSchema = z.object({
  itemId: z.string().uuid().describe("The line's itemId from get_cart."),
});

export const createAddressSchema = z.object({
  type: z.enum(["Home", "Work", "Other"]),
  name: z.string().min(2).describe("Recipient's name."),
  phone: z.string().min(10).max(15),
  line1: z.string().min(5).describe("House/flat number and street."),
  line2: z.string().optional().describe("Landmark or area."),
  city: z.string().min(2),
  state: z.string().min(2),
  pincode: z.string().length(6),
  isDefault: z.boolean().optional(),
});

export const startReservePaySetupSchema = z.object({
  amountInRupees: z
    .number()
    .int()
    .positive()
    .max(RESERVE_PAY_MAX_AMOUNT)
    .describe(
      `How much to block, in whole rupees. Maximum ₹${RESERVE_PAY_MAX_AMOUNT} (a regulatory ` +
        "cap). Suggest comfortably more than the current cart so later orders don't need a top-up."
    ),
  expiryDays: z
    .number()
    .int()
    .positive()
    .max(RESERVE_PAY_MAX_EXPIRY_DAYS)
    .optional()
    .describe(`How long the block stays usable. Max ${RESERVE_PAY_MAX_EXPIRY_DAYS} days.`),
});

export const prepareOrderSchema = z.object({
  addressId: z.string().uuid().describe("Address id from list_addresses."),
  slotId: z
    .enum(slotIds)
    .describe("Delivery slot id from list_delivery_slots. Must be one of the listed ids."),
});

export const placeOrderSchema = z.object({
  quoteId: z
    .string()
    .uuid()
    .describe(
      "The quoteId from prepare_order. Calling this twice with the same quoteId is safe — it " +
        "returns the same order rather than placing a second one."
    ),
});

export const listOrdersSchema = z.object({
  limit: z.number().int().min(1).max(10).default(5).describe("Most recent orders first."),
});

export const getOrderSchema = z
  .object({
    orderId: z.string().uuid().optional(),
    orderNumber: z.string().min(1).optional().describe('The customer-facing number, e.g. "FC-ABC123".'),
  })
  .refine((input) => Boolean(input.orderId || input.orderNumber), {
    message: "Provide either orderId or orderNumber",
  });

/** Tools that take no arguments still need a schema so runTool can validate uniformly. */
export const emptySchema = z.object({});
