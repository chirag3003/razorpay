import { env } from "../../config/env";
import { logger } from "../../logger";
import {
  deliverySlotLabel,
  RESERVE_PAY_DEFAULT_EXPIRY_DAYS,
  RESERVE_PAY_MAX_AMOUNT,
  RESERVE_PAY_MIN_AMOUNT,
  suggestReserveAmounts,
} from "../../constants";
import * as addressService from "../../services/addressService";
import * as auditService from "../../services/auditService";
import * as cartService from "../../services/cartService";
import * as mandateService from "../../services/mandateService";
import * as orderService from "../../services/orderService";
import * as reservePayService from "../../services/reservePayService";
import type { CartMandateSnapshot } from "../../db/schema";
import { ConflictError } from "../../errors";
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
    logger.error("reserve-pay", "sync failed, using local state", err, { mandateId: live.id });
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
    logger.error("reserve-pay", "could not read remaining balance", err, { userId });
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
  // Two calls create two addresses.
  annotations: { idempotentHint: false, destructiveHint: false },
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

const offerReservePayAmounts = defineTool({
  name: "offer_reserve_pay_amounts",
  description:
    "Show the customer a choice of reserve amounts. Call this whenever they need a reserved " +
    "balance — never pick the amount yourself. Blocks nothing: it renders the options and waits " +
    "for the customer to tap one, which is what tells you the amount for start_reserve_pay_setup. " +
    "Works for a top-up too: the options cover the whole cart, since replacing a block returns " +
    "the old one's balance to the customer — whatever they pick becomes their ENTIRE new " +
    "balance, never added to the amount that was released.",
  input: emptySchema,
  readOnly: true,
  handler: async (ctx) => {
    const cartId = await cartService.getOrCreateActiveCartId(ctx.userId);
    const cart = await cartService.getCartWithTotals(cartId);
    const suggestedAmounts = suggestReserveAmounts(cart.total);

    // Replacing an existing block releases its balance back to the customer, so the options are
    // sized against the whole cart either way — never against the shortfall.
    const liveMandate = await reservePayService.getLiveMandate(ctx.userId);
    const replacing = liveMandate !== null;
    const previousRemaining = liveMandate
      ? Math.round(reservePayService.remainingPaise(liveMandate) / 100)
      : null;

    // Every legal block is capped at RESERVE_PAY_MAX_AMOUNT, so a cart above it can never be
    // covered. Say so rather than offering an amount that buys a PIN approval and still fails.
    if (suggestedAmounts.length === 0) {
      toolError(
        "reserve_insufficient",
        `This order is ₹${cart.total}, above the ₹${RESERVE_PAY_MAX_AMOUNT} limit for a reserved balance.`,
        { hint: "Offer web checkout for this order instead." }
      );
    }

    return {
      suggestedAmounts,
      cartTotal: cart.total,
      minAmount: RESERVE_PAY_MIN_AMOUNT,
      maxAmount: RESERVE_PAY_MAX_AMOUNT,
      validityDays: RESERVE_PAY_DEFAULT_EXPIRY_DAYS,
      mode: replacing ? ("top_up" as const) : ("setup" as const),
      // A model that has just seen `previousRemaining` and is about to see a new amount is
      // exactly where "2000 + 1250 = 3250" happens — say the correct arithmetic explicitly
      // rather than relying on a rule read once, earlier, in the tool description.
      ...(previousRemaining !== null
        ? {
            note:
              `Replacing releases the ₹${previousRemaining} still on the current block back to ` +
              "the customer. Whichever amount they pick next becomes their entire new balance " +
              `once approved — it is not added to the ₹${previousRemaining} being released.`,
          }
        : {}),
      nextStep: replacing
        ? "The widget shows the options. Wait for the customer to choose, then call start_reserve_pay_setup with that amount and replaceExisting: true."
        : "The widget shows the options. Wait for the customer to choose — do not call start_reserve_pay_setup yet.",
    };
  },
});

const startReservePaySetup = defineTool({
  name: "start_reserve_pay_setup",
  // With replaceExisting it REVOKES the customer's current block — its remaining balance is
  // released, not carried over. Destructive in the sense clients care about.
  annotations: { idempotentHint: false, destructiveHint: true },
  description:
    "Begin setting up a reserved UPI balance. Returns a UPI deep link the customer must open and " +
    "approve with their PIN — this is the one step in the whole flow that needs a human. After " +
    "sending them the link, poll check_reserve_pay_status until it reports active. The customer " +
    "can only have one balance at a time, so topping up is a replacement: pass replaceExisting " +
    "to revoke the current block and create a bigger one. Only do that when they asked for it. " +
    "The new amount is the customer's ENTIRE balance once approved, not added to what the old " +
    "block had — the response's `note` field states this with the actual numbers whenever " +
    "replaceExisting applies; read it before telling the customer their balance. " +
    "If you are an external agent you receive approvalUrl, a page showing the amount, the account " +
    "and the UPI app buttons — send the customer that link, never a raw upi:// string.",
  input: startReservePaySetupSchema,
  readOnly: false,
  handler: async (ctx, input) => {
    // Snapshotted before createMandate revokes it — this is the only chance to state what's
    // being released, since createMandate's own revoke leaves nothing to read it back from.
    const previousRemaining = input.replaceExisting
      ? await reservePayService.getLiveMandate(ctx.userId).then((live) =>
          live ? Math.round(reservePayService.remainingPaise(live) / 100) : null
        )
      : null;

    const mandate = await reservePayService.createMandate(ctx.userId, input);
    const approvalUrl = mandate.approvalToken
      ? new URL(`/approve/${mandate.approvalToken}`, env.PUBLIC_APP_URL).toString()
      : null;

    // The exact bug this guards against: a model that just saw the old remaining balance and the
    // new amount narrates their sum instead of the replacement. State the correct arithmetic
    // here, next to the numbers, rather than trusting a rule read once at session start.
    const note =
      previousRemaining !== null
        ? `This replaces the old block — its ₹${previousRemaining} was released, not added. Once ` +
          `approved, the customer's balance is exactly ₹${input.amountInRupees}, never ` +
          `₹${input.amountInRupees} + ₹${previousRemaining}.`
        : undefined;

    // An agent has no widget to render into, so a raw upi:// string would reach the customer as
    // unreadable text they cannot tap on a desktop. Withholding it rather than merely advising
    // against it is what makes that impossible — the hosted page shows the amount, whose account
    // it credits, the per-app buttons and a QR.
    if (ctx.actor.type === "agent") {
      return {
        mandate: toAgentMandate(mandate),
        approvalUrl,
        ...(note ? { note } : {}),
        nextStep:
          "Send the customer approvalUrl and nothing else — never a upi:// link. Then poll check_reserve_pay_status until status is active.",
      };
    }

    return {
      mandate: toAgentMandate(mandate),
      // The generic upi:// link is the default — the OS offers the customer's own apps.
      intentUrl: mandate.intentUrl,
      intentLinks: mandate.intentLinks,
      approvalUrl,
      ...(note ? { note } : {}),
      nextStep:
        "The widget shows the approval buttons. Poll check_reserve_pay_status until status is active.",
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

    // ChatMandate.status has no `pending`, so toAgentMandate collapses an unapproved block to
    // `revoked` — which reads as "the customer's approval failed" and sends the model into
    // telling them to start over. State it separately so polling behaves like polling.
    const awaitingApproval = mandate.status === "pending";

    return {
      state: "found" as const,
      mandate: toAgentMandate(mandate),
      awaitingApproval,
      ...(awaitingApproval
        ? { hint: "Not approved yet. Ask the customer to approve in their UPI app, then poll again." }
        : {}),
    };
  },
});

const prepareOrder = defineTool({
  name: "prepare_order",
  // Takes no money, but it supersedes any previous open quote, so calling it twice does not
  // leave the world as one call did.
  annotations: { idempotentHint: false, destructiveHint: false },
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
      // No tokenId: no widget renders it.
      payment: {
        method: "reserve_pay" as const,
        remaining: presented.remaining,
      },
    };
  },
});

const placeOrder = defineTool({
  name: "place_order",
  // Genuinely idempotent, by quoteId: a second call returns the same order rather than placing
  // another. Advertising it is what tells a client a retry after a timeout is safe — which is
  // the difference between a recovered order and a double-charge attempt.
  annotations: { idempotentHint: true, destructiveHint: false },
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

    // Same shape as the fingerprint check: the quote named a specific block, and a customer who
    // revoked and recreated theirs since is a different authority than the one they approved.
    // prepareDebit enforces this too — that is the guarantee — but it can only raise
    // MandateNotActiveError, whose hint sends the model to start_reserve_pay_setup and would
    // revoke the customer's brand-new block. Check here so the guidance is right.
    const liveMandate = await reservePayService.getLiveMandate(ctx.userId);
    if (liveMandate && liveMandate.id !== quote.mandateId) {
      await mandateService.markStatus(quote.id, "superseded");
      toolError(
        "quote_superseded",
        "The customer's reserved balance was replaced after this quote was created.",
        {
          retryable: true,
          hint: "Their new balance is fine — just call prepare_order again and re-confirm the fresh quote. Do NOT call start_reserve_pay_setup; that would revoke the block they just approved.",
        }
      );
    }

    // The existing, already-verified payment path — no payment logic reimplemented here.
    //
    // The third argument is what the customer actually approved. checkoutWithReservePay re-derives
    // its snapshot from the live cart at charge time, so without it the charged total and the
    // charged mandate are both whatever is true at that instant rather than whatever the signed
    // quote named. It now refuses on either divergence instead of charging and recording the fact.
    let order;
    try {
      order = await orderService.checkoutWithReservePay(
        ctx.userId,
        { addressId: quote.addressId, deliverySlot: quote.deliverySlot },
        { total: quote.snapshot.total, mandateId: quote.mandateId }
      );
    } catch (err) {
      // A total divergence is the same situation as a failed fingerprint check above, so give the
      // model the same recoverable code rather than the generic `conflict` a ConflictError maps
      // to. Nothing was charged — the refusal happens before prepareDebit.
      if (err instanceof ConflictError) {
        await mandateService.markStatus(quote.id, "superseded");
        toolError("cart_changed", err.message, {
          retryable: true,
          hint: "Call prepare_order again, show the customer the updated total, and re-confirm.",
        });
      }
      throw err;
    }

    // Kept in the audit row, but it can no longer be false on this path — the charge is refused
    // above rather than reaching here with a different total.
    const totalMatchesQuote = order.total === quote.snapshot.total;

    try {
      await mandateService.markStatus(quote.id, "consumed", order.id);
    } catch (err) {
      // The money moved and the order exists; only bookkeeping failed. An error here would tell
      // the customer their order failed when it didn't. A retry is safe — the cart is now empty,
      // so the fingerprint check rejects it rather than double-charging.
      logger.error("checkout", "failed to mark cart mandate consumed", err, { quoteId: quote.id });
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
  offerReservePayAmounts,
  startReservePaySetup,
  checkReservePayStatus,
  prepareOrder,
  placeOrder,
];
