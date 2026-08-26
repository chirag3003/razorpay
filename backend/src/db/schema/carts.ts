import { pgTable, uuid, text, jsonb, timestamp, integer, unique } from "drizzle-orm/pg-core";
import { users } from "./users";
import { products } from "./products";

// Pending checkout details captured at /checkout/initiate, consumed at /checkout/verify
// (or cleared on a payment.failed webhook). Nothing here once there's no in-flight checkout.
export type CheckoutSnapshot = {
  address: {
    type: string;
    name: string;
    phone: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };
  deliverySlot: string;
  paymentMethod: string;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
};

export const carts = pgTable("carts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  checkoutRazorpayOrderId: text("checkout_razorpay_order_id").unique(),
  checkoutSnapshot: jsonb("checkout_snapshot").$type<CheckoutSnapshot>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    qty: integer("qty").notNull(),
  },
  (table) => [unique().on(table.cartId, table.productId)]
);
