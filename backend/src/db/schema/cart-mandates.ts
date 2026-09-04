import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  check,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { carts } from "./carts";
import { orders } from "./orders";
import { reservePayMandates } from "./reserve-pay";
import { CART_MANDATE_STATUSES } from "../../constants";

// A line as it stood at issue. Prices frozen, so the record shows what was agreed rather than
// what the catalog says today.
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

// A signed, per-transaction record of what an agent proposed to buy: issued by prepare_order,
// spent by place_order. Distinct from the Reserve Pay mandate, which is the standing authority —
// this is the specific one, and it makes an agent purchase auditable rather than "a debit
// happened". A consumed quote carries the order it produced, which is what makes place_order
// idempotent under a retry.
//
// Whole rupees, matching carts/orders. Only the Reserve Pay tables use paise.
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
    // Compared again immediately before charging, so a cart that moved under the quote
    // invalidates it rather than silently charging a different basket.
    cartFingerprint: text("cart_fingerprint").notNull(),
    // HMAC over the canonical snapshot — what makes this a mandate rather than a cache entry.
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
    // At most one open quote per user. prepare_order supersedes any prior open quote rather than
    // colliding; this index is the backstop for two concurrent prepare calls.
    uniqueIndex("cart_mandates_one_open_per_user")
      .on(t.userId)
      .where(sql`${t.status} = 'open'`),
    // getOpenCartMandate runs on every chat turn; the partial unique above only covers `open`
    // rows, so a plain user_id index is still needed for getCartMandate and history reads.
    index("cart_mandates_user_idx").on(t.userId),
  ]
);
