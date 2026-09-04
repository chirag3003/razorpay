import { DELIVERY_FEE, FREE_DELIVERY_THRESHOLD, MAX_CART_ITEM_QTY } from "../../constants";
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

// The storefront routes its own cart writes through the browser's cart store and reports them
// via clientState. These tools exist for external agents, which have no browser, and to keep one
// implementation rather than two that can drift.
//
// cartService's mutators return void, so each tool re-reads and returns the whole cart — the
// caller almost always wants the new totals, and a follow-up get_cart is a wasted round trip.

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
    `₹${FREE_DELIVERY_THRESHOLD}, otherwise ₹${DELIVERY_FEE}.`,
  input: emptySchema,
  readOnly: true,
  handler: async (ctx) => currentCart(ctx),
});

const addToCart = defineTool({
  name: "add_to_cart",
  // Additive by design, so a blind retry after a timeout adds the quantity twice.
  annotations: { idempotentHint: false, destructiveHint: false },
  description:
    "Add a product to the cart. Quantity is ADDITIVE — calling twice with qty 1 leaves 2 in the " +
    "cart, so to set an exact quantity use update_cart_item instead. Returns the updated cart.",
  input: addToCartSchema,
  readOnly: false,
  handler: async (ctx, input) => {
    // cartService.addItem enforces both the stock check and the per-line cap for every caller.
    // These two checks are deliberately duplicated here, ahead of it, purely for the wording: a
    // ToolFailure carries a model-facing `hint` naming the product and the headroom left, which a
    // mapped DomainError cannot. The service is the guarantee; this is the better error message.
    const product = input.productId
      ? await productService.getProductById(input.productId)
      : await productService.getProductBySlug(input.slug!);

    if (!product.inStock) {
      toolError("product_unavailable", `${product.name} is out of stock.`, {
        hint: "Offer an alternative — list_related_products will suggest items in the same category.",
      });
    }

    const cartId = await cartService.getOrCreateActiveCartId(ctx.userId);

    // Against the resulting line, not the increment, since qty is additive.
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
  // Absolute quantity — running it twice leaves the same line quantity.
  annotations: { idempotentHint: true, destructiveHint: false },
  description:
    "Set a cart line to an exact quantity. Takes the line's itemId from get_cart, not a product " +
    "id. To take a line out of the cart, use remove_from_cart.",
  input: updateCartItemSchema,
  readOnly: false,
  handler: async (ctx, input) => {
    const cartId = await cartService.getOrCreateActiveCartId(ctx.userId);

    // The schema floors qty at 1. cartService.updateItemQty deletes the row at qty <= 0, which
    // is surprising for a tool named "update" — remove_from_cart says what it means.
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
  // Removing an already-removed line is a not_found, not a second removal.
  annotations: { idempotentHint: true, destructiveHint: true },
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
  // Irreversible and there is no undo — the tool description says so, and a client that reads
  // annotations rather than prose should learn the same thing.
  annotations: { destructiveHint: true, idempotentHint: true },
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
