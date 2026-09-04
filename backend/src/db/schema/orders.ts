import {
  pgTable,
  uuid,
  text,
  jsonb,
  integer,
  timestamp,
  check,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { products } from "./products";
import type { CheckoutSnapshot } from "./carts";
import { ORDER_STATUSES } from "../../constants";

// Immutable snapshot: stored inline rather than as a live FK so it survives the address being
// edited or deleted later.
export type OrderAddress = CheckoutSnapshot["address"];

export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  address: jsonb("address").$type<OrderAddress>().notNull(),
  deliverySlot: text("delivery_slot").notNull(),
  paymentMethod: text("payment_method").notNull(),
  razorpayOrderId: text("razorpay_order_id").notNull().unique(),
  razorpayPaymentId: text("razorpay_payment_id").notNull(),
  subtotal: integer("subtotal").notNull(),
  deliveryFee: integer("delivery_fee").notNull(),
  discount: integer("discount").notNull(),
  total: integer("total").notNull(),
  // Always starts "placed" — a row exists only once payment is confirmed, so there is no
  // "pending payment" state to model. Constrained to ORDER_STATUSES by the CHECK below.
  status: text("status").notNull().default("placed"),
  placedAt: timestamp("placed_at").notNull().defaultNow(),
}, (t) => [
  // listOrders, getOrderById and the admin filters all select by user_id, and listOrders orders
  // by placed_at within it — one composite index serves both halves.
  index("orders_user_placed_idx").on(t.userId, t.placedAt.desc()),
  check(
    "orders_status_check",
    sql`${t.status} in (${sql.join(
      ORDER_STATUSES.map((s) => sql`${s}`),
      sql`, `
    )})`
  ),
]);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    qty: integer("qty").notNull(),
    priceAtPurchase: integer("price_at_purchase").notNull(),
  },
  // Every order hydration selects by order_id.
  (t) => [index("order_items_order_idx").on(t.orderId)]
);
