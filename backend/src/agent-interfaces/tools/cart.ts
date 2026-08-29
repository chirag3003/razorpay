import { MAX_CART_ITEM_QTY } from "../../constants";
import * as auditService from "../../services/auditService";
import * as cartService from "../../services/cartService";
import * as productService from "../../services/productService";
import {
  addToCartSchema,
  emptySchema,
  removeFromCartSchema,
  updateCartItemSchema,
} from "../../schemas/agent-tool.schema";
import { toAgentCart } from "./presenters";
import { defineTool, toolError, type ToolContext } from "./types";

// Cart tools.
//
// The first-party chat has its own route for these — web/lib/chat/protocol.ts routes cart writes
// through the browser's cart store and tells the agent about them via clientState. These tools
// exist because an external agent over A2A/MCP has no browser, and because Hard Rule #2 wants one
// implementation rather than two that can drift.
//
// The mutators in cartService all return void, so every tool here re-reads the cart and returns
// the whole thing — a model that just changed the cart almost always wants the new totals, and
// making it call get_cart afterwards is a wasted round-trip.

async function currentCart(ctx: ToolContext) {
  const cartId = await cartService.getOrCreateActiveCartId(ctx.userId);
  return toAgentCart(await cartService.getCartWithTotals(cartId));
}

async function auditCart(
  ctx: ToolContext,
  action: string,
  metadata: Record<string, unknown>
) {
  await auditService.log({
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    action,
    decision: "approved",
    outcome: "success",
    metadata: { ...metadata, conversationId: ctx.conversationId ?? null },
  });
}

const getCart = defineTool({
  name: "get_cart",
  description:
    "The customer's current cart with line items and totals, priced live. Delivery is free over " +
    "₹199, otherwise ₹25.",
  input: emptySchema,
  readOnly: true,
  handler: async (ctx) => currentCart(ctx),
});

const addToCart = defineTool({
  name: "add_to_cart",
  description:
    "Add a product to the cart. Quantity is ADDITIVE — calling twice with qty 1 leaves 2 in the " +
    "cart, so to set an exact quantity use update_cart_item instead. Returns the updated cart.",
  input: addToCartSchema,
  readOnly: false,
  handler: async (ctx, input) => {
    // Resolve to a product id and, in doing so, confirm the product is real and sellable.
    // cartService.addItem only checks that the product isn't archived — it never reads inStock
    // and never validates quantity, because the REST route's Zod schema did both and agents
    // don't pass through it. reservePayService.createMandate set this precedent of re-asserting
    // limits for non-route callers.
    const product = input.productId
      ? await productService.getProductById(input.productId)
      : await productService.getProductBySlug(input.slug!);

    if (!product.inStock) {
      toolError("product_unavailable", `${product.name} is out of stock.`, {
        hint: "Offer an alternative — list_related_products will suggest items in the same category.",
      });
    }

    const cartId = await cartService.getOrCreateActiveCartId(ctx.userId);

    // Enforced against the resulting line, not the increment, since qty is additive.
    const existing = await cartService.getCartWithTotals(cartId);
    const currentQty =
      existing.items.find((item) => item.product.id === product.id)?.qty ?? 0;

    if (currentQty + input.qty > MAX_CART_ITEM_QTY) {
      toolError(
        "invalid_input",
        `That would put ${product.name} at ${currentQty + input.qty}, over the limit of ${MAX_CART_ITEM_QTY} per item.`,
        {
          retryable: true,
          hint: `The cart already holds ${currentQty}. Add at most ${MAX_CART_ITEM_QTY - currentQty} more.`,
        }
      );
    }

    await cartService.addItem(cartId, product.id, input.qty);
    await auditCart(ctx, "agent.cart.add_item", {
      productId: product.id,
      name: product.name,
      qty: input.qty,
    });

    return toAgentCart(await cartService.getCartWithTotals(cartId));
  },
});

const updateCartItem = defineTool({
  name: "update_cart_item",
  description:
    "Set a cart line to an exact quantity. Takes the line's itemId from get_cart, not a product " +
    "id. To take a line out of the cart, use remove_from_cart.",
  input: updateCartItemSchema,
  readOnly: false,
  handler: async (ctx, input) => {
    const cartId = await cartService.getOrCreateActiveCartId(ctx.userId);

    // The schema already floors qty at 1. cartService.updateItemQty deletes the row on qty <= 0,
    // which is a surprising thing for a tool named "update" to do — remove_from_cart says what it
    // means, and a model choosing between them will pick correctly.
    await cartService.updateItemQty(cartId, input.itemId, input.qty);
    await auditCart(ctx, "agent.cart.update_item", {
      itemId: input.itemId,
      qty: input.qty,
    });

    return toAgentCart(await cartService.getCartWithTotals(cartId));
  },
});

const removeFromCart = defineTool({
  name: "remove_from_cart",
  description: "Remove one line from the cart entirely. Takes the itemId from get_cart.",
  input: removeFromCartSchema,
  readOnly: false,
  handler: async (ctx, input) => {
    const cartId = await cartService.getOrCreateActiveCartId(ctx.userId);
    await cartService.removeItem(cartId, input.itemId);
    await auditCart(ctx, "agent.cart.remove_item", { itemId: input.itemId });

    return toAgentCart(await cartService.getCartWithTotals(cartId));
  },
});

const clearCart = defineTool({
  name: "clear_cart",
  description:
    "Empty the cart. Only do this when the customer explicitly asks — it is not reversible and " +
    "there is no undo.",
  input: emptySchema,
  readOnly: false,
  handler: async (ctx) => {
    const cartId = await cartService.getOrCreateActiveCartId(ctx.userId);
    await cartService.clearCartItems(cartId);
    await auditCart(ctx, "agent.cart.clear", { cartId });

    return toAgentCart(await cartService.getCartWithTotals(cartId));
  },
});

export const cartTools = [getCart, addToCart, updateCartItem, removeFromCart, clearCart];
