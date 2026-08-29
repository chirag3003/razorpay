import { deliverySlotLabel } from "../../constants";
import * as addressService from "../../services/addressService";
import * as auditService from "../../services/auditService";
import * as cartService from "../../services/cartService";
import * as mandateService from "../../services/mandateService";
import * as orderService from "../../services/orderService";
import * as reservePayService from "../../services/reservePayService";
import type { CartMandateSnapshot } from "../../db/schema";
import {
  createAddressSchema,
  emptySchema,
  placeOrderSchema,
  prepareOrderSchema,
  startReservePaySetupSchema,
} from "../../schemas/agent-tool.schema";
import {
  toAgentAddress,
  toAgentMandate,
  toAgentOrder,
  toAgentSlots,
} from "./presenters";
import { defineTool, toolError, type ToolContext } from "./types";

// Checkout tools: addresses, slots, the Reserve Pay balance, and the two-step order placement.
//
// No payment logic lives here. prepare_order builds a Cart Mandate and place_order hands off to
// orderService.checkoutWithReservePay, which already owns the reserve → stash → charge → confirm
// sequence. Duplicating any part of that in the tool layer would violate Hard Rule #2 and give
// agents a payment path the storefront never exercises.

/**
 * The customer's mandate, refreshed from Razorpay when possible.
 *
 * getMandate re-syncs, which is what keeps the balance honest — but it also means two network
 * round-trips and a hard failure if the provider is unreachable. The balance already lives in our
 * own ledger, so a provider outage should not stop the agent telling a customer what they have
 * reserved. Fall back to the local row and let the caller carry on.
 *
 * Safe because nothing here authorises a payment: reservePayService.prepareDebit re-syncs and
 * re-checks the balance atomically at charge time, so a stale read can only ever cause a
 * decline, never an overdraw.
 */
async function mandateView(userId: string) {
  const live = await reservePayService.getLiveMandate(userId);
  if (!live) return null;

  try {
    return { mandate: await reservePayService.getMandate(userId, live.id), stale: false };
  } catch (err) {
    console.error(`Reserve Pay sync failed for mandate ${live.id}; using local state:`, err);
    return { mandate: reservePayService.presentMandate(live), stale: true };
  }
}

const listAddresses = defineTool({
  name: "list_addresses",
  description:
    "The customer's saved delivery addresses. Call before prepare_order — you need an addressId. " +
    "If the list is empty, use create_address.",
  input: emptySchema,
  readOnly: true,
  handler: async (ctx) => {
    const addresses = await addressService.listAddresses(ctx.userId);
    return { addresses: addresses.map(toAgentAddress) };
  },
});

const createAddress = defineTool({
  name: "create_address",
  description:
    "Save a new delivery address. Ask the customer for every field — never invent an address, " +
    "and never guess a pincode from a city name.",
  input: createAddressSchema,
  readOnly: false,
  handler: async (ctx, input) => {
    const address = await addressService.createAddress(ctx.userId, input);

    await auditService.log({
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      action: "agent.address.create",
      decision: "approved",
      outcome: "success",
      metadata: { addressId: address.id, conversationId: ctx.conversationId ?? null },
    });

    return { address: toAgentAddress(address) };
  },
});

const listDeliverySlots = defineTool({
  name: "list_delivery_slots",
  description:
    "Available delivery slots. prepare_order needs one of these slot ids — no other value is " +
    "accepted, so don't offer the customer a time that isn't on this list.",
  input: emptySchema,
  readOnly: true,
  handler: async () => ({ slots: toAgentSlots() }),
});

/**
 * Reserve Pay state, shaped to answer "can this customer pay right now, and if not, what do they
 * need to do". Mirrors the frontend's ReservePayStatusPart, including `needed`, so the AI layer
 * can render the widget straight from this.
 */
const getPaymentStatus = defineTool({
  name: "get_payment_status",
  description:
    "Whether the customer can pay for the current cart with their reserved UPI balance. Returns " +
    "a state of none, active, expired, revoked or insufficient, the shortfall when insufficient, " +
    "and the actions worth offering. Call this before prepare_order so you can set up or top up " +
    "the balance first rather than failing at checkout.",
  input: emptySchema,
  readOnly: true,
  handler: async (ctx) => {
    const cartId = await cartService.getOrCreateActiveCartId(ctx.userId);
    const cart = await cartService.getCartWithTotals(cartId);

    const view = await mandateView(ctx.userId);
    if (!view) {
      return {
        state: "none" as const,
        cartTotal: cart.total,
        actions: ["setup"],
      };
    }

    const presented = toAgentMandate(view.mandate);

    if (presented.status !== "active") {
      return {
        state: presented.status === "expired" ? ("expired" as const) : ("revoked" as const),
        mandate: presented,
        cartTotal: cart.total,
        stale: view.stale,
        actions: ["renew", "use_web_checkout"],
      };
    }

    if (cart.total > 0 && presented.remaining < cart.total) {
      return {
        state: "insufficient" as const,
        mandate: presented,
        cartTotal: cart.total,
        needed: cart.total - presented.remaining,
        stale: view.stale,
        actions: ["top_up", "use_web_checkout"],
      };
    }

    return {
      state: "active" as const,
      mandate: presented,
      cartTotal: cart.total,
      stale: view.stale,
      actions: [],
    };
  },
});

const startReservePaySetup = defineTool({
  name: "start_reserve_pay_setup",
  description:
    "Begin setting up a reserved UPI balance. Returns a UPI deep link the customer must open and " +
    "approve with their PIN — this is the one step in the whole flow that needs a human. After " +
    "sending them the link, poll check_reserve_pay_status until it reports active. The customer " +
    "can only have one balance at a time.",
  input: startReservePaySetupSchema,
  readOnly: false,
  handler: async (ctx, input) => {
    const mandate = await reservePayService.createMandate(ctx.userId, input);

    return {
      mandate: toAgentMandate(mandate),
      // The generic upi:// link is the right default — it lets the OS offer the customer's apps.
      intentUrl: mandate.intentUrl,
      intentLinks: mandate.intentLinks,
      nextStep:
        "Send the customer the intent link, then poll check_reserve_pay_status until status is active.",
    };
  },
});

const checkReservePayStatus = defineTool({
  name: "check_reserve_pay_status",
  description:
    "Re-check the reserved balance against the payment provider. Use this to poll while the " +
    "customer is approving the block in their UPI app. Status stays 'pending' until they approve. " +
    "Unlike get_payment_status this always contacts the payment provider, so it fails if the " +
    "provider is unreachable.",
  input: emptySchema,
  readOnly: true,
  handler: async (ctx) => {
    const live = await reservePayService.getLiveMandate(ctx.userId);
    if (!live) return { state: "none" as const };

    const mandate = await reservePayService.getMandate(ctx.userId, live.id);
    return { state: "found" as const, mandate: toAgentMandate(mandate) };
  },
});

const prepareOrder = defineTool({
  name: "prepare_order",
  description:
    "Build an order quote for the customer to approve. Returns the exact lines, totals, address " +
    "and slot, plus a quoteId. Show this to the customer and get an explicit yes before calling " +
    "place_order — this tool takes no money. The quote expires, and changing the cart afterwards " +
    "invalidates it.",
  input: prepareOrderSchema,
  readOnly: false,
  handler: async (ctx, input) => {
    const slotLabel = deliverySlotLabel(input.slotId);
    if (!slotLabel) {
      toolError("invalid_slot", `"${input.slotId}" is not a delivery slot.`, {
        hint: "Call list_delivery_slots and use one of the returned ids.",
      });
    }

    // Ownership-checked; throws InvalidAddressError for an id belonging to somebody else.
    await addressService.getAddressForUser(ctx.userId, input.addressId);

    const cartId = await cartService.getOrCreateActiveCartId(ctx.userId);
    const cart = await cartService.requireNonEmptyCart(cartId);

    const view = await mandateView(ctx.userId);
    if (!view) {
      toolError("mandate_missing", "The customer has no reserved UPI balance.", {
        hint: "Call get_payment_status, then start_reserve_pay_setup.",
      });
    }

    const mandate = view.mandate;
    const presented = toAgentMandate(mandate);

    if (presented.status !== "active") {
      toolError(
        presented.status === "expired" ? "mandate_expired" : "mandate_revoked",
        `The customer's reserved balance is ${presented.detailedStatus}.`,
        { hint: "Set up a new balance with start_reserve_pay_setup." }
      );
    }

    // Checked here as well as inside the debit so the customer is told before being shown a
    // review they can't complete. reservePayService re-checks atomically at charge time; this is
    // the friendly copy, that one is the guarantee.
    if (presented.remaining < cart.total) {
      toolError(
        "reserve_insufficient",
        `The order is ₹${cart.total} but only ₹${presented.remaining} is reserved.`,
        { hint: `Offer to top up by ₹${cart.total - presented.remaining}.` }
      );
    }

    const snapshot: CartMandateSnapshot = {
      lines: cart.items.map((item) => ({
        itemId: item.itemId,
        productId: item.product.id,
        name: item.product.name,
        qty: item.qty,
        price: item.product.price,
      })),
      subtotal: cart.subtotal,
      deliveryFee: cart.deliveryFee,
      discount: 0,
      total: cart.total,
    };

    const quote = await mandateService.createCartMandate({
      userId: ctx.userId,
      cartId,
      mandateId: mandate.id,
      addressId: input.addressId,
      deliverySlot: slotLabel,
      snapshot,
    });

    await auditService.log({
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      action: "agent.order.prepare",
      mandateScope: { mandateId: mandate.id, remaining: presented.remaining },
      decision: "approved",
      outcome: "success",
      metadata: {
        quoteId: quote.id,
        total: snapshot.total,
        conversationId: ctx.conversationId ?? null,
      },
    });

    return {
      ...mandateService.presentCartMandate(quote),
      payment: {
        method: "reserve_pay" as const,
        // tokenId: presented.tokenId,
        remaining: presented.remaining,
      },
    };
  },
});

const placeOrder = defineTool({
  name: "place_order",
  description:
    "Charge the customer's reserved balance and place the order for a quote from prepare_order. " +
    "Only call this after the customer has explicitly confirmed. Safe to retry: calling it twice " +
    "with the same quoteId returns the same order rather than placing a second one.",
  input: placeOrderSchema,
  readOnly: false,
  handler: async (ctx, input) => {
    const quote = await mandateService.getCartMandate(ctx.userId, input.quoteId);

    // Idempotency. A retrying model — or a duplicated tool call — lands here and gets the order
    // that already exists instead of buying the cart twice.
    if (quote.status === "consumed" && quote.orderId) {
      const order = await orderService.getOrderById(ctx.userId, quote.orderId);
      return { order: toAgentOrder(order), alreadyPlaced: true };
    }

    if (quote.status === "superseded") {
      toolError("quote_superseded", "That quote was replaced by a newer one.", {
        retryable: true,
        hint: "Call prepare_order again and confirm the fresh quote with the customer.",
      });
    }

    if (quote.status === "expired" || mandateService.isExpired(quote)) {
      await mandateService.markStatus(quote.id, "expired");
      toolError("quote_expired", "That quote has expired.", {
        retryable: true,
        hint: "Call prepare_order again to get a current quote.",
      });
    }

    if (!mandateService.verifySignature(quote)) {
      // The stored record doesn't match its own signature — it was altered after we issued it.
      // Refuse rather than charge against a record we can't vouch for.
      await mandateService.markStatus(quote.id, "superseded");
      toolError("conflict", "That quote failed its integrity check.", {
        hint: "Call prepare_order to issue a new one.",
      });
    }

    // Checked as late as possible, immediately before charging: the customer approved a specific
    // basket at a specific price, and if the cart has moved since then this quote no longer
    // describes what they'd be buying.
    const cartId = await cartService.getOrCreateActiveCartId(ctx.userId);
    const cart = await cartService.requireNonEmptyCart(cartId);
    const currentFingerprint = mandateService.fingerprintLines(
      cart.items.map((item) => ({
        itemId: item.itemId,
        productId: item.product.id,
        name: item.product.name,
        qty: item.qty,
        price: item.product.price,
      }))
    );

    if (currentFingerprint !== quote.cartFingerprint) {
      await mandateService.markStatus(quote.id, "superseded");
      toolError("cart_changed", "The cart changed after this quote was created.", {
        retryable: true,
        hint: "Call prepare_order again, show the customer the updated total, and re-confirm.",
      });
    }

    // The existing, already-verified payment path. No payment logic is reimplemented here.
    const order = await orderService.checkoutWithReservePay(ctx.userId, {
      addressId: quote.addressId,
      deliverySlot: quote.deliverySlot,
    });

    // checkoutWithReservePay re-derives its own snapshot from the live cart at charge time, so
    // in principle the charged total can differ from the quoted one. The fingerprint check above
    // makes that window sub-millisecond and same-user-only, but it doesn't close it — so record
    // any divergence rather than letting it pass silently.
    const totalMatchesQuote = order.total === quote.snapshot.total;

    try {
      await mandateService.markStatus(quote.id, "consumed", order.id);
    } catch (err) {
      // The money moved and the order exists; only our bookkeeping failed. Returning an error
      // here would tell the customer their order failed when it didn't. A retry is safe: the
      // cart is now empty, so the fingerprint check rejects it rather than double-charging.
      console.error(`Failed to mark cart mandate ${quote.id} consumed:`, err);
    }

    await auditService.log({
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      action: "agent.order.place",
      mandateScope: { quoteId: quote.id, mandateId: quote.mandateId },
      decision: "approved",
      outcome: "success",
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        quotedTotal: quote.snapshot.total,
        chargedTotal: order.total,
        totalMatchesQuote,
        conversationId: ctx.conversationId ?? null,
      },
    });

    return { order: toAgentOrder(order), alreadyPlaced: false };
  },
});

export const checkoutTools = [
  listAddresses,
  createAddress,
  listDeliverySlots,
  getPaymentStatus,
  startReservePaySetup,
  checkReservePayStatus,
  prepareOrder,
  placeOrder,
];
