import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  check,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { carts } from "./carts";
import { orders } from "./orders";
import { reservePayMandates } from "./reserve-pay";
import { CART_MANDATE_STATUSES } from "../../constants";

// A line as it stood when the quote was issued. Prices are frozen here so the record shows what
// was actually agreed, not what the catalog says today.
export type CartMandateLine = {
  itemId: string;
  productId: string;
  name: string;
  qty: number;
  price: number;
};

export type CartMandateSnapshot = {
  lines: CartMandateLine[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
};

// The Cart Mandate: a signed, per-transaction record of exactly what an agent proposed to buy,
// issued by prepare_order and spent by place_order.
//
// Distinct from the Reserve Pay mandate, which is the customer's *general* standing authority to
// be charged. This is the specific one — this cart, this total, this moment — and it is what
// makes an agent purchase auditable after the fact rather than just "a debit happened".
//
// It also does the practical work of making order placement idempotent: a consumed quote carries
// the order it produced, so an LLM retrying place_order gets that same order back instead of
// buying the cart twice.
//
// Money here is whole rupees, matching carts/orders. Only the Reserve Pay tables use paise.
export const cartMandates = pgTable(
  "cart_mandates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    // The Reserve Pay block this quote is drawn against — the link between the specific
    // authority and the general one.
    mandateId: uuid("mandate_id")
      .notNull()
      .references(() => reservePayMandates.id, { onDelete: "restrict" }),
    addressId: uuid("address_id").notNull(),
    // Stored as the human label ("Today, 2:00 PM - 4:00 PM"), the same form the storefront
    // checkout writes, so an agent order is indistinguishable from a web one downstream.
    deliverySlot: text("delivery_slot").notNull(),
    snapshot: jsonb("snapshot").$type<CartMandateSnapshot>().notNull(),
    // Hash of the cart contents at issue time. Compared again immediately before charging, so a
    // cart that moved underneath the quote invalidates it instead of silently charging a
    // different basket than the customer approved.
    cartFingerprint: text("cart_fingerprint").notNull(),
    // HMAC over the canonical snapshot. Makes the record tamper-evident, which is the point of
    // calling it a mandate rather than a cache entry.
    signature: text("signature").notNull(),
    status: text("status").notNull().default("open"),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "cart_mandates_status_check",
      sql`${t.status} in (${sql.join(
        CART_MANDATE_STATUSES.map((s) => sql`${s}`),
        sql`, `
      )})`
    ),
    // At most one open quote per user. carts.user_id is already unique, so per-user and per-cart
    // are the same constraint — keyed on user because that is what the tool layer has in hand.
    // prepare_order supersedes any prior open quote rather than colliding with it; this index is
    // the backstop for two concurrent prepare calls.
    uniqueIndex("cart_mandates_one_open_per_user")
      .on(t.userId)
      .where(sql`${t.status} = 'open'`),
  ]
);
