import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { carts, orderItems, orders, products, type CheckoutSnapshot } from "../db/schema";
import { EmptyCartError, NotFoundError } from "../errors";
import * as addressService from "./addressService";
import * as auditService from "./auditService";
import * as cartService from "./cartService";
import * as paymentService from "./paymentService";
import * as reservePayService from "./reservePayService";
import type { InitiateCheckoutInput } from "../schemas/checkout.schema";
import { pgErrorCode, PG_UNIQUE_VIOLATION } from "../utils/db-error";

function generateOrderNumber() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.floor(Math.random() * 36 ** 3)
    .toString(36)
    .toUpperCase()
    .padStart(3, "0");
  return `FC-${timestamp}${random}`;
}

// Validates the cart and address and freezes the totals. Shared by both checkout paths — the
// browser one (initiateCheckout) and the headless Reserve Pay one — so they can't drift apart
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
    subtotal: cart.subtotal,
    deliveryFee: cart.deliveryFee,
    discount,
    total: cart.total - discount,
  };

  return { cartId, snapshot };
}

// Records the in-flight checkout attempt on the cart. confirmPayment finds the cart by this
// razorpay order id, which is how both checkout paths converge on one order-creation routine.
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
 * Headless checkout against a UPI Reserve Pay mandate — no Checkout.js popup, no signature
 * round-trip with the client, no customer interaction. This is the path AI-initiated orders take.
 *
 * The sequence is reserve -> stash -> charge -> confirm, and the ordering is the whole point.
 * The cart snapshot must be on the cart *before* any money moves, because that snapshot is what
 * the payment.captured webhook rebuilds the order from if this process dies mid-charge. Stashing
 * after the charge (the obvious ordering) would leave exactly one unrecoverable window: money
 * taken, no order, and a webhook with nothing to reconstruct from. prepareDebit reserves the
 * funds and creates the Razorpay order without charging, which is what makes stashing early safe.
 */
export async function checkoutWithReservePay(userId: string, input: InitiateCheckoutInput) {
  const { cartId, snapshot } = await buildCheckoutSnapshot(userId, input, "upi_reserve_pay");

  const prepared = await reservePayService.prepareDebit({
    userId,
    amountInRupees: snapshot.total,
    // Unique per attempt, not per cart — a retried checkout is a separate debit and needs its
    // own receipt to stay traceable in reconciliation.
    receipt: `cart_${cartId.slice(0, 8)}_${Date.now().toString(36)}`,
  });

  await stashPendingCheckout(cartId, prepared.razorpayOrderId, snapshot);

  let debit;
  try {
    debit = await reservePayService.executeDebit(prepared.debitId, {
      description: `Order from cart ${cartId.slice(0, 8)}`,
    });
  } catch (err) {
    // Nothing was charged, so clear the pending checkout rather than leaving the cart pointing
    // at a Razorpay order that will never be paid — a stale stash would make the next
    // payment.failed webhook wipe a checkout the customer never started.
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

// Called by both the /checkout/verify route and the payment.captured webhook — signature
// verification happens in the caller (each has a different signature scheme); this function
// assumes the payment is already verified and just does the order-creation side, idempotently.
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
  const cartWithTotals = await cartService.getCartWithTotals(cart.id);
  if (cartWithTotals.items.length === 0) throw new EmptyCartError();

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
        cartWithTotals.items.map((item) => ({
          orderId: order.id,
          productId: item.product.id,
          qty: item.qty,
          priceAtPurchase: item.product.price,
        }))
      );

      return order.id;
    });
  } catch (err) {
    // Unique violation on orders.razorpay_order_id — the webhook and /verify raced each
    // other and the other one won. Idempotent no-op: return what it created.
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

// Signature check failed on /checkout/verify. The Razorpay order itself may still be genuine
// (client sent a malformed/tampered payload) so the pending checkout snapshot is left in
// place — a payment.captured webhook can still confirm it later. Just records the attempt.
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

// Clears a cart's pending checkout attempt on payment.failed — leaves the cart items intact
// so the user can retry (a fresh /initiate call issues a new Razorpay order).
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

// Exported so adminOrderService can return the exact same order+items+product shape the
// storefront order endpoints use, without duplicating the join.
export async function getOrderWithItems(orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) throw new NotFoundError("Order");

  const items = await db
    .select({
      productId: orderItems.productId,
      qty: orderItems.qty,
      priceAtPurchase: orderItems.priceAtPurchase,
      product: products,
    })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(eq(orderItems.orderId, orderId));

  return { ...order, items };
}

export async function listOrders(userId: string) {
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.placedAt));

  return Promise.all(rows.map((row) => getOrderWithItems(row.id)));
}

export async function getOrderById(userId: string, orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.userId !== userId) throw new NotFoundError("Order");
  return getOrderWithItems(orderId);
}
