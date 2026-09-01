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
  toAgentCartLine,
  toAgentMandate,
  toAgentOrder,
  toAgentSlots,
} from "./presenters";
import { defineTool, toolError, type ToolContext } from "./types";

// Addresses, slots, Reserve Pay balance, and the two-step order placement.
//
// No payment logic here: prepare_order builds a Cart Mandate, place_order hands off to
// orderService.checkoutWithReservePay. Duplicating any of that would give agents a payment path
// the storefront never exercises.

/**
 * The customer's mandate, refreshed from Razorpay when possible, falling back to the local row on
 * a provider outage — a balance question should not fail just because Razorpay is unreachable.
 *
 * Safe because nothing here authorises a payment: prepareDebit re-syncs and re-checks atomically
 * at charge time, so a stale read causes a decline, never an overdraw.
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

/**
 * Remaining balance, read locally. Not getMandate: this runs immediately after a charge, where
 * the local ledger is fresher (Razorpay's `amount_debited` is eventually consistent). Zero on
 * failure — a bookkeeping read must never turn a completed order into an error.
 */
async function remainingAfterCharge(userId: string): Promise<number> {
  try {
    const live = await reservePayService.getLiveMandate(userId);
    if (!live) return 0;
    return toAgentMandate(reservePayService.presentMandate(live)).remaining;
  } catch (err) {
    console.error(`Could not read remaining balance for user ${userId}:`, err);
    return 0;
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
 * Answers "can this customer pay right now, and if not, what next". Mirrors the frontend's
 * ReservePayStatusPart, including `needed`, so the widget renders straight from it.
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
      // The generic upi:// link is the default — the OS offers the customer's own apps.
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

    // Throws InvalidAddressError for an id belonging to somebody else.
    const address = await addressService.getAddressForUser(ctx.userId, input.addressId);

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

    // Checked here as well as inside the debit, so the customer is told before seeing a review
    // they cannot complete. The atomic re-check at charge time is the guarantee; this is copy.
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
      // The signed snapshot carries only what the signature covers (productId/qty/price); these
      // add display fields from the same read, so the review shows a unit and an image. Money
      // still comes from the snapshot.
      lines: cart.items.map(toAgentCartLine),
      address: toAgentAddress(address),
      slot: { id: input.slotId, label: slotLabel },
      // No tokenId: no widget renders it. See web/issues.md for the frontend follow-up.
      payment: {
        method: "reserve_pay" as const,
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

    // Idempotency: a retrying model gets the existing order instead of buying the cart twice.
    if (quote.status === "consumed" && quote.orderId) {
      const order = await orderService.getOrderById(ctx.userId, quote.orderId);
      return {
        order: toAgentOrder(order),
        alreadyPlaced: true,
        debited: order.total,
        remainingAfter: await remainingAfterCharge(ctx.userId),
      };
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
      // The record doesn't match its own signature — altered after issue. Refuse rather than
      // charge against a record we cannot vouch for.
      await mandateService.markStatus(quote.id, "superseded");
      toolError("conflict", "That quote failed its integrity check.", {
        hint: "Call prepare_order to issue a new one.",
      });
    }

    // As late as possible, immediately before charging: the customer approved a specific basket
    // at a specific price, and a cart that moved since means the quote no longer describes it.
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

    // Derived from the snapshot, NOT read from quote.cartFingerprint: the signature covers the
    // snapshot but not that column. Trusting it would let a rewritten cart_fingerprint pass both
    // this check and the signature check while charging the quoted total for different goods.
    const quotedFingerprint = mandateService.fingerprintLines(quote.snapshot.lines);

    if (currentFingerprint !== quotedFingerprint) {
      await mandateService.markStatus(quote.id, "superseded");
      toolError("cart_changed", "The cart changed after this quote was created.", {
        retryable: true,
        hint: "Call prepare_order again, show the customer the updated total, and re-confirm.",
      });
    }

    // The existing, already-verified payment path — no payment logic reimplemented here.
    const order = await orderService.checkoutWithReservePay(ctx.userId, {
      addressId: quote.addressId,
      deliverySlot: quote.deliverySlot,
    });

    // checkoutWithReservePay re-derives its snapshot from the live cart at charge time, so the
    // charged total can in principle differ from the quoted one. The fingerprint check narrows
    // that window but does not close it — record any divergence rather than lose it.
    const totalMatchesQuote = order.total === quote.snapshot.total;

    try {
      await mandateService.markStatus(quote.id, "consumed", order.id);
    } catch (err) {
      // The money moved and the order exists; only bookkeeping failed. An error here would tell
      // the customer their order failed when it didn't. A retry is safe — the cart is now empty,
      // so the fingerprint check rejects it rather than double-charging.
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

    return {
      order: toAgentOrder(order),
      alreadyPlaced: false,
      debited: order.total,
      remainingAfter: await remainingAfterCharge(ctx.userId),
    };
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
