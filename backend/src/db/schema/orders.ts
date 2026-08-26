import { pgTable, uuid, text, jsonb, integer, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";
import { products } from "./products";
import type { CheckoutSnapshot } from "./carts";

// Immutable snapshot of the address at the time of the order — must survive the address
// being edited or deleted later, so it's stored inline rather than as a live foreign key.
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
  // Fulfillment status — always starts "placed"; an order row only exists once payment
  // is confirmed, so there is no "pending payment" status to model here.
  status: text("status").notNull().default("placed"),
  placedAt: timestamp("placed_at").notNull().defaultNow(),
});

export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "restrict" }),
  qty: integer("qty").notNull(),
  priceAtPurchase: integer("price_at_purchase").notNull(),
});
