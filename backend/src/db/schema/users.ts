import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull(),
  passwordHash: text("password_hash").notNull(),
  // Created lazily on the first Reserve Pay mandate and reused for every one after: Razorpay
  // links recurring tokens to customers, so a new customer per mandate would orphan them.
  razorpayCustomerId: text("razorpay_customer_id").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
