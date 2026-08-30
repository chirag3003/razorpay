// Regulatory/config numbers centralized here — never hardcode these inline in a service.

export const CURRENCY = "INR";

// Storefront pricing (in rupees, matching how products.price/mrp are stored).
export const FREE_DELIVERY_THRESHOLD = 199;
export const DELIVERY_FEE = 25;

// Ceiling for a price filter on search_products. products.price is a Postgres `integer` column
// (max 2147483647), and search_products' minPrice/maxPrice had no upper bound at all — an LLM
// asked for "no limit" once sent `maxPrice: Number.MAX_SAFE_INTEGER` (9007199254740991), which
// overflowed the column and crashed the query instead of returning a validation error the model
// could recover from. This is far above any real product price, so it never constrains a
// legitimate search; it only catches sentinel/overflow values before they reach the DB.
export const MAX_PRODUCT_PRICE = 1_000_000;

export function getDeliveryFee(subtotal: number) {
  if (subtotal === 0) return 0;
  return subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
}

// Order fulfillment lifecycle. An order row only exists once payment is confirmed, so the
// first state is always "placed"; an admin advances it from there (any -> any, no transition
// rules yet). Enforced by a Zod enum on the admin route AND a Postgres CHECK on the orders
// table, both built from this one list.
export const ORDER_STATUSES = [
  "placed",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Delivery slots. Mirrors web/components/checkout/delivery-slot-picker.tsx exactly — same ids,
// same day/time strings — because orders.delivery_slot stores the human LABEL, not the id, and
// an agent-placed order has to be indistinguishable from a web-placed one in the admin views.
//
// The REST checkout schema deliberately stays `z.string().min(1)`: the storefront posts a label,
// so turning that field into an enum of ids would break it. The constraint applies at the agent
// tool boundary instead, where the caller is untrusted and free text would otherwise let an LLM
// write "asap" into an order a human then has to fulfil.
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

// Per-line cart ceiling. cartService.addItem has no quantity validation of its own — the only
// guard today is the REST route's Zod schema, which agent callers never pass through — and its
// quantity is additive, so an LLM looping add_to_cart could otherwise run a line to any number.
export const MAX_CART_ITEM_QTY = 20;

// Cart Mandate (the signed order quote handed to an agent by prepare_order). Short-lived on
// purpose: it freezes a price, and the longer it lives the more likely the cart behind it has
// moved on.
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

// Reserve Pay (UPI SBMD). Both are hard regulatory ceilings, not preferences — Razorpay
// rejects an authorisation order that exceeds either. Amount is in rupees to match the rest
// of this file; the paise conversion happens at the paymentService boundary.
export const RESERVE_PAY_MAX_AMOUNT = 10_000;
export const RESERVE_PAY_MAX_EXPIRY_DAYS = 90;

// Floor for a Reserve Pay block. Not a regulatory limit — blocking ₹20 is pointless friction:
// the customer spends a UPI PIN approval to cover less than one order.
export const RESERVE_PAY_MIN_AMOUNT = 500;

/**
 * A sensible block size for a given cart total, mirroring web/lib/chat/format.ts
 * `suggestReserveAmount`. Roughly three orders' worth, rounded to ₹500, clamped to the legal
 * range. Asking someone to block the ₹10,000 ceiling to buy ₹380 of tomatoes is how a checkout
 * gets abandoned.
 */
export function suggestReserveAmounts(cartTotal: number): number[] {
  const target = Math.ceil((cartTotal * 3) / 500) * 500;
  const primary = Math.min(RESERVE_PAY_MAX_AMOUNT, Math.max(1_000, target));

  return [...new Set([primary, primary * 2, RESERVE_PAY_MAX_AMOUNT])]
    .filter((amount) => amount >= RESERVE_PAY_MIN_AMOUNT && amount <= RESERVE_PAY_MAX_AMOUNT)
    .sort((a, b) => a - b);
}

// Default block lifetime. Deliberately short of the 90-day ceiling: expire_at is sent as an
// absolute timestamp, and asking for exactly the maximum leaves no headroom for clock skew
// between us and Razorpay.
export const RESERVE_PAY_DEFAULT_EXPIRY_DAYS = 30;

// How long an unapproved mandate holds the one-live-mandate-per-user slot. A customer who
// closes their UPI app mid-approval would otherwise be locked out of creating another one
// forever; past this age createMandate expires the stale row and proceeds.
export const RESERVE_PAY_PENDING_TTL_MINUTES = 15;

// Mandate lifecycle. "pending" and "confirmed" are the two live states — a partial unique
// index on reserve_pay_mandates allows only one row per user in either of them. The rest are
// terminal. Same three-way enforcement as ORDER_STATUSES: TS type, Zod enum, Postgres CHECK.
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

// The two live states, shared by the uniqueness index and every "is this usable" check so the
// definition of "live" can't drift between them.
// "paused" counts as live: the block still holds the customer's funds, so it must keep holding
// the per-user slot too. assertDebitable rejects it separately.
export const LIVE_MANDATE_STATUSES = ["pending", "confirmed", "paused"] as const;

// One row per debit attempt against a mandate, including the ones that failed — this table is
// the reconciliation ledger and the Recovery Agent's future input, so failures are rows, not
// dropped exceptions.
export const RESERVE_PAY_DEBIT_STATUSES = ["created", "captured", "failed"] as const;

export type ReservePayDebitStatus = (typeof RESERVE_PAY_DEBIT_STATUSES)[number];
