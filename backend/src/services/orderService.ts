import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { carts, orderItems, orders, products, type CheckoutSnapshot } from "../db/schema";
import { ConflictError, EmptyCartError, NotFoundError } from "../errors";
import { logger } from "../logger";
import * as addressService from "./addressService";
import * as auditService from "./auditService";
import * as cartService from "./cartService";
import * as paymentService from "./paymentService";
import * as reservePayService from "./reservePayService";
import type { InitiateCheckoutInput } from "../schemas/checkout.schema";
import { pgErrorCode, PG_UNIQUE_VIOLATION } from "../utils/db-error";
import { MAX_ORDER_PAGE_SIZE } from "../constants";

function generateOrderNumber() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.floor(Math.random() * 36 ** 3)
    .toString(36)
    .toUpperCase()
    .padStart(3, "0");
  return `FC-${timestamp}${random}`;
}

// Validates cart and address, freezes totals. Shared by both checkout paths so they cannot drift
// on what gets charged or which errors a bad cart produces.
async function buildCheckoutSnapshot(
  userId: string,
  input: InitiateCheckoutInput,
  paymentMethod?: string
) {
  const cartId = await cartService.getOrCreateActiveCartId(userId);
  const cart = await cartService.requireNonEmptyCart(cartId);
  const address = await addressService.getAddressForUser(userId, input.addressId);

  const discount = 0;
  const snapshot: CheckoutSnapshot = {
    address: {
      type: address.type,
      name: address.name,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2 ?? undefined,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
    },
    deliverySlot: input.deliverySlot,
    paymentMethod: paymentMethod ?? input.paymentMethod ?? "razorpay",
    // The approved basket, frozen here alongside the totals it produced. confirmPayment builds
    // the order's line items from this, not from the live cart — otherwise the two halves of an
    // order disagree: totals from the snapshot, items and prices from whatever the cart and the
    // catalog say by the time payment lands.
    lines: cart.items.map((item) => ({
      productId: item.product.id,
      qty: item.qty,
      price: item.product.price,
    })),
    subtotal: cart.subtotal,
    deliveryFee: cart.deliveryFee,
    discount,
    total: cart.total - discount,
  };

  return { cartId, snapshot };
}

// Records the in-flight attempt on the cart. confirmPayment finds the cart by this Razorpay
// order id, which is how both checkout paths converge on one order-creation routine.
async function stashPendingCheckout(
  cartId: string,
  razorpayOrderId: string,
  snapshot: CheckoutSnapshot
) {
  await db
    .update(carts)
    .set({ checkoutRazorpayOrderId: razorpayOrderId, checkoutSnapshot: snapshot })
    .where(eq(carts.id, cartId));
}

export async function initiateCheckout(userId: string, input: InitiateCheckoutInput) {
  const { cartId, snapshot } = await buildCheckoutSnapshot(userId, input);

  const razorpayOrder = await paymentService.createRazorpayOrder({
    amountInRupees: snapshot.total,
    receipt: `cart_${cartId}`,
  });

  await stashPendingCheckout(cartId, razorpayOrder.razorpayOrderId, snapshot);

  return razorpayOrder;
}

/**
 * Headless checkout against a Reserve Pay mandate — no Checkout.js, no client signature
 * round-trip, no customer interaction. The path AI-initiated orders take.
 *
 * Sequence is reserve -> stash -> charge -> confirm, and the order matters: the snapshot must be
 * on the cart before any money moves, because that is what the payment.captured webhook rebuilds
 * the order from if this process dies mid-charge. Stashing after the charge would leave one
 * unrecoverable window — money taken, no order, nothing to reconstruct from.
 */
export async function checkoutWithReservePay(
  userId: string,
  input: InitiateCheckoutInput,
  /**
   * What a signed quote said this charge would be. Supplied by place_order; omitted by the direct
   * REST route, which has no prior quote to honour. When present, both fields are enforced before
   * any money moves — see below.
   */
  expected?: { total: number; mandateId: string }
) {
  const { cartId, snapshot } = await buildCheckoutSnapshot(userId, input, "upi_reserve_pay");

  // The snapshot is re-derived from the live cart here, so it can differ from the total the
  // customer actually approved. Refuse rather than charge a figure nobody agreed to: place_order's
  // fingerprint check narrows this window to sub-millisecond but explicitly does not close it.
  if (expected && snapshot.total !== expected.total) {
    throw new ConflictError(
      `The cart changed after this quote was created — it now totals ₹${snapshot.total}, not ₹${expected.total}.`
    );
  }

  const prepared = await reservePayService.prepareDebit({
    userId,
    amountInRupees: snapshot.total,
    // Unique per attempt, not per cart: a retried checkout is a separate debit and needs its own
    // receipt to stay traceable in reconciliation.
    receipt: `cart_${cartId.slice(0, 8)}_${Date.now().toString(36)}`,
    // Charge the block the quote named, not whichever one happens to be live now. A customer who
    // revokes and recreates their block between prepare_order and place_order would otherwise be
    // charged against a mandate the signed quote never mentioned, and the signature would still
    // verify because nothing covers mandateId.
    expectedMandateId: expected?.mandateId,
  });

  await stashPendingCheckout(cartId, prepared.razorpayOrderId, snapshot);

  let debit;
  try {
    debit = await reservePayService.executeDebit(prepared.debitId, {
      description: `Order from cart ${cartId.slice(0, 8)}`,
    });
  } catch (err) {
    // Nothing was charged. Clear the stash rather than leave the cart pointing at an order that
    // will never be paid — the next payment.failed webhook would wipe an unrelated checkout.
    await db
      .update(carts)
      .set({ checkoutRazorpayOrderId: null, checkoutSnapshot: null })
      .where(eq(carts.id, cartId));
    throw err;
  }

  const order = await confirmPayment(debit.razorpayOrderId, debit.razorpayPaymentId);

  await reservePayService.attachOrderToDebit(debit.debitId, order.id);

  return order;
}

// Called by /checkout/verify and the payment.captured webhook. Signature verification happens in
// the caller (the two use different schemes); this assumes it passed and creates the order
// idempotently.
export async function confirmPayment(razorpayOrderId: string, razorpayPaymentId: string) {
  const [existingOrder] = await db
    .select()
    .from(orders)
    .where(eq(orders.razorpayOrderId, razorpayOrderId))
    .limit(1);

  if (existingOrder) {
    return getOrderWithItems(existingOrder.id);
  }

  const [cart] = await db
    .select()
    .from(carts)
    .where(eq(carts.checkoutRazorpayOrderId, razorpayOrderId))
    .limit(1);

  if (!cart || !cart.checkoutSnapshot) {
    throw new NotFoundError("Checkout session");
  }

  const snapshot = cart.checkoutSnapshot;

  // Built from the frozen snapshot, so the order records what was approved. The live-cart read is
  // only a fallback for a snapshot written before `lines` existed and still in flight; it is the
  // old, wrong behaviour, so it says so in the log.
  let orderLines = snapshot.lines;
  if (!orderLines) {
    logger.warn("checkout", "checkout snapshot has no lines — falling back to the live cart", {
      cartId: cart.id,
      razorpayOrderId,
    });
    const cartWithTotals = await cartService.getCartWithTotals(cart.id);
    orderLines = cartWithTotals.items.map((item) => ({
      productId: item.product.id,
      qty: item.qty,
      price: item.product.price,
    }));
  }

  if (orderLines.length === 0) throw new EmptyCartError();

  let orderId: string;
  try {
    orderId = await db.transaction(async (tx) => {
      const [order] = await tx
        .insert(orders)
        .values({
          orderNumber: generateOrderNumber(),
          userId: cart.userId,
          address: snapshot.address,
          deliverySlot: snapshot.deliverySlot,
          paymentMethod: snapshot.paymentMethod,
          razorpayOrderId,
          razorpayPaymentId,
          subtotal: snapshot.subtotal,
          deliveryFee: snapshot.deliveryFee,
          discount: snapshot.discount,
          total: snapshot.total,
        })
        .returning({ id: orders.id });

      if (!order) throw new Error("Failed to create order");

      await tx.insert(orderItems).values(
        orderLines.map((line) => ({
          orderId: order.id,
          productId: line.productId,
          qty: line.qty,
          priceAtPurchase: line.price,
        }))
      );

      return order.id;
    });
  } catch (err) {
    // Unique violation on orders.razorpay_order_id: the webhook and /verify raced and the other
    // won. Return what it created.
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
      const [raced] = await db
        .select()
        .from(orders)
        .where(eq(orders.razorpayOrderId, razorpayOrderId))
        .limit(1);
      if (raced) return getOrderWithItems(raced.id);
    }
    throw err;
  }

  await cartService.clearCartItems(cart.id);
  await db
    .update(carts)
    .set({ checkoutRazorpayOrderId: null, checkoutSnapshot: null })
    .where(eq(carts.id, cart.id));

  await auditService.log({
    actorType: "user",
    actorId: cart.userId,
    action: "checkout",
    decision: "approved",
    outcome: "success",
    metadata: { orderId, razorpayOrderId, razorpayPaymentId, total: snapshot.total },
  });

  return getOrderWithItems(orderId);
}

// Signature check failed on /checkout/verify. The Razorpay order may still be genuine, so the
// pending snapshot is left in place for a payment.captured webhook to confirm later.
export async function recordFailedVerification(razorpayOrderId: string) {
  const [cart] = await db
    .select({ userId: carts.userId })
    .from(carts)
    .where(eq(carts.checkoutRazorpayOrderId, razorpayOrderId))
    .limit(1);

  await auditService.log({
    actorType: "user",
    actorId: cart?.userId ?? "unknown",
    action: "checkout",
    decision: "rejected",
    outcome: "failed",
    metadata: { razorpayOrderId, reason: "signature_verification_failed" },
  });
}

// Clears the pending attempt on payment.failed. Cart items stay, so a fresh /initiate can retry.
export async function cancelPendingCheckout(razorpayOrderId: string) {
  const [cart] = await db
    .select({ id: carts.id, userId: carts.userId })
    .from(carts)
    .where(eq(carts.checkoutRazorpayOrderId, razorpayOrderId))
    .limit(1);

  if (!cart) return;

  await db
    .update(carts)
    .set({ checkoutRazorpayOrderId: null, checkoutSnapshot: null })
    .where(eq(carts.id, cart.id));

  await auditService.log({
    actorType: "user",
    actorId: cart.userId,
    action: "checkout",
    decision: "approved",
    outcome: "failed",
    metadata: { razorpayOrderId },
  });
}

type OrderRow = typeof orders.$inferSelect;

/**
 * Attaches items to a page of already-selected order rows in ONE query, rather than one query per
 * order. Exported so adminOrderService hydrates the same way instead of looping getOrderWithItems
 * — which re-selected the order it had just been handed, on top of its items.
 */
export async function attachItems<T extends OrderRow>(orderRows: T[]) {
  if (orderRows.length === 0) return [];

  const rows = await db
    .select({
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      qty: orderItems.qty,
      priceAtPurchase: orderItems.priceAtPurchase,
      product: products,
    })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(
      inArray(
        orderItems.orderId,
        orderRows.map((order) => order.id)
      )
    );

  const byOrder = new Map<string, Omit<(typeof rows)[number], "orderId">[]>();
  for (const { orderId, ...item } of rows) {
    const bucket = byOrder.get(orderId);
    if (bucket) bucket.push(item);
    else byOrder.set(orderId, [item]);
  }

  return orderRows.map((order) => ({ ...order, items: byOrder.get(order.id) ?? [] }));
}

// Exported so adminOrderService returns the same order+items+product shape without duplicating
// the join. Single-order path; use attachItems for a page.
export async function getOrderWithItems(orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) throw new NotFoundError("Order");

  const [hydrated] = await attachItems([order]);
  if (!hydrated) throw new NotFoundError("Order");
  return hydrated;
}

/**
 * A page of the customer's orders, newest first, with items — two queries total.
 *
 * It was previously 1 + 2N: the order rows, then every one mapped through getOrderWithItems,
 * which re-selected the order plus its items. Twenty orders was 41 round trips over an unindexed
 * user_id, with no limit or offset anywhere.
 */
export async function listOrders(
  userId: string,
  options: { limit?: number; offset?: number } = {}
) {
  const rows = await db
    .select({ order: orders, totalCount: sql<number>`count(*) over()::int` })
    .from(orders)
    .where(eq(orders.userId, userId))
    // asc(id) so equal placedAt values cannot make a page repeat or skip an order.
    .orderBy(desc(orders.placedAt), desc(orders.id))
    .limit(options.limit ?? MAX_ORDER_PAGE_SIZE)
    .offset(options.offset ?? 0);

  return {
    items: await attachItems(rows.map((row) => row.order)),
    total: rows[0]?.totalCount ?? 0,
  };
}

export async function getOrderById(userId: string, orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.userId !== userId) throw new NotFoundError("Order");
  return getOrderWithItems(orderId);
}

/**
 * Resolve a customer-facing order number ("FC-…") within one user's own orders. Here rather than
 * in the tool that wanted it: /agent-interfaces never touches the database (Service Layer Rule),
 * and orders.ts was reaching for `db` directly to do this.
 *
 * Scoped to the caller in the query itself, so an order number belonging to someone else is
 * indistinguishable from one that does not exist — the same anti-probing shape getOrderById uses.
 */
export async function getOrderByNumber(userId: string, orderNumber: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.orderNumber, orderNumber), eq(orders.userId, userId)))
    .limit(1);

  if (!order) throw new NotFoundError("Order");
  return getOrderWithItems(order.id);
}
