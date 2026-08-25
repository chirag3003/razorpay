import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  real,
  unique,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const addresses = pgTable("addresses", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "Home" | "Work" | "Other"
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  line1: text("line1").notNull(),
  line2: text("line2"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  pincode: text("pincode").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
});

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
  image: text("image").notNull(),
});

export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "restrict" }),
  price: integer("price").notNull(),
  mrp: integer("mrp").notNull(),
  unit: text("unit").notNull(),
  image: text("image").notNull(),
  images: text("images").array().notNull(),
  description: text("description").notNull(),
  rating: real("rating").notNull().default(0),
  ratingCount: integer("rating_count").notNull().default(0),
  inStock: boolean("in_stock").notNull().default(true),
  tags: text("tags").array().notNull().default([]),
});

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

// Hard Rule #4 (root claude.md): every money-moving action must be logged here with actor,
// mandate/scope checked, decision, and outcome. actorType/mandateScope are already shaped for
// the future agent_tokens system — this phase only ever writes actorType "user" with a null
// mandateScope, since there's nothing to check yet.
export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorType: text("actor_type").notNull(), // "user" | "agent" | "system"
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  mandateScope: jsonb("mandate_scope"),
  decision: text("decision").notNull(), // "approved" | "rejected"
  outcome: text("outcome").notNull(), // "success" | "failed"
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
