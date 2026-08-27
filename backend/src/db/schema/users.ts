import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull(),
  passwordHash: text("password_hash").notNull(),
  // Razorpay customer id, created lazily the first time this user sets up a UPI Reserve Pay
  // mandate and reused for every mandate after that — Razorpay links recurring tokens to
  // customers, so re-creating one per mandate would orphan the earlier tokens.
  razorpayCustomerId: text("razorpay_customer_id").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
