// Regulatory/config numbers centralized here — never hardcode these inline in a service.

export const CURRENCY = "INR";

// Storefront pricing (in rupees, matching how products.price/mrp are stored).
export const FREE_DELIVERY_THRESHOLD = 199;
export const DELIVERY_FEE = 25;

// Ceiling for search_products price filters. products.price is a Postgres integer, so an LLM
// sending Number.MAX_SAFE_INTEGER for "no limit" overflows the column and crashes the query
// instead of returning a recoverable validation error. Far above any real price.
export const MAX_PRODUCT_PRICE = 1_000_000;

export function getDeliveryFee(subtotal: number) {
  if (subtotal === 0) return 0;
  return subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
}

// Order fulfillment lifecycle. A row exists only once payment is confirmed, so the first state
// is always "placed"; an admin advances it from there (any -> any, no transition rules yet).
// Enforced by a Zod enum on the admin route and a Postgres CHECK, both built from this list.
export const ORDER_STATUSES = [
  "placed",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Mirrors web/components/checkout/delivery-slot-picker.tsx exactly, because orders.delivery_slot
// stores the human LABEL and an agent-placed order must be indistinguishable from a web one.
//
// The REST checkout schema stays `z.string().min(1)` — the storefront posts a label, so an enum
// of ids would break it. The constraint applies at the agent tool boundary instead, where free
// text would otherwise let an LLM write "asap" into an order a human has to fulfil.
export const DELIVERY_SLOTS = [
  { id: "today-2-4", day: "Today", time: "2:00 PM - 4:00 PM" },
  { id: "today-4-6", day: "Today", time: "4:00 PM - 6:00 PM" },
  { id: "today-6-8", day: "Today", time: "6:00 PM - 8:00 PM" },
  { id: "tomorrow-10-12", day: "Tomorrow", time: "10:00 AM - 12:00 PM" },
  { id: "tomorrow-12-2", day: "Tomorrow", time: "12:00 PM - 2:00 PM" },
  { id: "tomorrow-2-4", day: "Tomorrow", time: "2:00 PM - 4:00 PM" },
] as const;

export type DeliverySlot = (typeof DELIVERY_SLOTS)[number];
export type DeliverySlotId = DeliverySlot["id"];

export function getDeliverySlot(slotId: string): DeliverySlot | undefined {
  return DELIVERY_SLOTS.find((slot) => slot.id === slotId);
}

/** The exact string the storefront checkout writes: `${day}, ${time}`. */
export function deliverySlotLabel(slotId: string): string | undefined {
  const slot = getDeliverySlot(slotId);
  return slot ? `${slot.day}, ${slot.time}` : undefined;
}

// Per-line cart ceiling. cartService.addItem has no quantity validation of its own and qty is
// additive, so an LLM looping add_to_cart could otherwise run a line to any number.
export const MAX_CART_ITEM_QTY = 20;

// The signed order quote from prepare_order. Short-lived: it freezes a price, and the longer it
// lives the more likely the cart behind it has moved.
export const CART_MANDATE_TTL_MINUTES = 15;

// Quote lifecycle.
//   open        awaiting place_order
//   consumed    an order was created from it; carries the orderId, which is what makes
//               place_order idempotent rather than double-charging on an LLM retry
//   superseded  a newer quote replaced it, or the cart changed underneath it
//   expired     passed its TTL unused
export const CART_MANDATE_STATUSES = [
  "open",
  "consumed",
  "superseded",
  "expired",
] as const;

export type CartMandateStatus = (typeof CART_MANDATE_STATUSES)[number];

// Hard regulatory ceilings, not preferences — Razorpay rejects an authorisation order exceeding
// either. Rupees here; the paise conversion happens at the paymentService boundary.
export const RESERVE_PAY_MAX_AMOUNT = 10_000;
export const RESERVE_PAY_MAX_EXPIRY_DAYS = 90;

// Not a regulatory limit — blocking ₹20 costs a UPI PIN approval to cover less than one order.
export const RESERVE_PAY_MIN_AMOUNT = 500;

// Every rung is a multiple of ₹500. Fixed rather than computed so the customer sees the same
// recognisable amounts each time instead of a figure derived from whatever is in their cart.
const RESERVE_AMOUNT_LADDER = [1_000, 2_000, 3_000, 5_000, RESERVE_PAY_MAX_AMOUNT] as const;

/** How many rungs to offer. More than four turns a quick choice into a form. */
const RESERVE_AMOUNT_OPTIONS = 4;

/**
 * Block sizes offered for a given cart total. Every option is strictly above that total — a block
 * that cannot cover the order in hand is worse than useless, since the customer spends a UPI PIN
 * to still be unable to pay. Empty when the cart is at or above the ₹10,000 ceiling: no legal
 * block covers it, and the caller must fall back to web checkout rather than offer a short one.
 */
export function suggestReserveAmounts(cartTotal: number): number[] {
  const usable = RESERVE_AMOUNT_LADDER.filter(
    (amount) =>
      amount > cartTotal &&
      amount >= RESERVE_PAY_MIN_AMOUNT &&
      amount <= RESERVE_PAY_MAX_AMOUNT
  );

  // Cheapest rungs plus the ceiling, not simply the first four: the smallest workable block is
  // the common choice, and the ceiling is the one people reach for to avoid topping up later.
  return [...new Set([...usable.slice(0, RESERVE_AMOUNT_OPTIONS - 1), ...usable.slice(-1)])];
}

// Short of the 90-day ceiling: expire_at is an absolute timestamp, and asking for exactly the
// maximum leaves no headroom for clock skew against Razorpay.
export const RESERVE_PAY_DEFAULT_EXPIRY_DAYS = 30;

// How long an unapproved mandate holds the one-live-per-user slot. Past this age createMandate
// expires the stale row and proceeds, so closing the UPI app mid-approval isn't a permanent lock.
export const RESERVE_PAY_PENDING_TTL_MINUTES = 15;

// Mandate lifecycle. Same three-way enforcement as ORDER_STATUSES: TS type, Zod enum, CHECK.
//   pending    authorisation payment created, customer hasn't approved in their UPI app yet
//   confirmed  funds blocked, token issued, debitable
//   paused     Razorpay/NPCI suspended the mandate; still live, but not debitable
//   failed     the customer declined, or the bank/gateway rejected the authorisation
//   revoked    we stopped honouring it locally (see reservePayService.revokeMandate)
//   expired    past expire_at; the block is released by the bank
//   exhausted  amount_debited caught up with amount_blocked, nothing left to draw on
export const MANDATE_STATUSES = [
  "pending",
  "confirmed",
  "paused",
  "failed",
  "revoked",
  "expired",
  "exhausted",
] as const;

export type MandateStatus = (typeof MANDATE_STATUSES)[number];

// Shared by the uniqueness index and every "is this usable" check, so the definition can't
// drift. "paused" counts as live — the block still holds the customer's funds, so it must keep
// holding the per-user slot. assertDebitable rejects it separately.
export const LIVE_MANDATE_STATUSES = ["pending", "confirmed", "paused"] as const;

// One row per debit attempt, failures included — this is the reconciliation ledger, so a
// rejection is a row, not a dropped exception.
export const RESERVE_PAY_DEBIT_STATUSES = ["created", "captured", "failed"] as const;

export type ReservePayDebitStatus = (typeof RESERVE_PAY_DEBIT_STATUSES)[number];
