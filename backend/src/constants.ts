// Regulatory/config numbers centralized here — never hardcode these inline in a service.

export const CURRENCY = "INR";

// Storefront pricing (in rupees, matching how products.price/mrp are stored).
export const FREE_DELIVERY_THRESHOLD = 199;
export const DELIVERY_FEE = 25;

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

// Reserve Pay (UPI SBMD) constants — not used yet, wired up once the agent token /
// Reserve Pay flow is built (root claude.md, Days 6-7). Left here so callers of this
// file don't need to change import paths when that lands.
// export const RESERVE_PAY_MAX_AMOUNT = 10_000;
// export const RESERVE_PAY_MAX_EXPIRY_DAYS = 90;
