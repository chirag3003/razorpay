import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  check,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { orders } from "./orders";
import {
  LIVE_MANDATE_STATUSES,
  MANDATE_STATUSES,
  RESERVE_PAY_DEBIT_STATUSES,
} from "../../constants";

// UPI Reserve Pay (single block, multiple debit) — the rail every AI-initiated payment runs on.
//
// Money here is PAISE, unlike products/carts/orders. These tables mirror Razorpay entities
// field-for-field and reconcile against Razorpay's values, so they carry Razorpay's unit. The
// `_paise` suffix is load-bearing — never add a bare `amount` column to either table.
export const reservePayMandates = pgTable(
  "reserve_pay_mandates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    razorpayCustomerId: text("razorpay_customer_id").notNull(),
    // The authorisation order/payment the customer approves — distinct from the per-debit orders
    // in reserve_pay_debits. Nullable because the row is inserted before Razorpay is called: that
    // insert is the atomic slot claim, so a lost race fails before any funds are blocked.
    razorpayOrderId: text("razorpay_order_id").unique(),
    razorpayPaymentId: text("razorpay_payment_id"),
    // Null until the customer approves in their UPI app; this is the key every debit references.
    razorpayTokenId: text("razorpay_token_id").unique(),
    status: text("status").notNull().default("pending"),
    // token.max_amount, the per-transaction ceiling. Equals the block amount for Reserve Pay, so
    // it doubles as the requested figure before Razorpay confirms the real one.
    maxAmountPaise: integer("max_amount_paise").notNull(),
    // Mirrored from the token's recurring_details once confirmed. Razorpay is the source of
    // truth; amountDebitedPaise is bumped optimistically per debit and syncMandate corrects it.
    amountBlockedPaise: integer("amount_blocked_paise").notNull().default(0),
    amountDebitedPaise: integer("amount_debited_paise").notNull().default(0),
    vpa: text("vpa"),
    failureReason: text("failure_reason"),
    // Stored so the status endpoint can hand it back — a customer who closed the app
    // mid-approval needs the link again.
    intentUrl: text("intent_url"),
    // Unguessable key for the unauthenticated approval page an agent sends the customer.
    // Deliberately not the row's id: that is already handed to agents as `tokenId`, and an
    // identifier a caller holds should not double as the capability that opens a public page.
    approvalToken: text("approval_token").unique(),
    expiresAt: timestamp("expires_at").notNull(),
    confirmedAt: timestamp("confirmed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    // When syncMandate last actually reconciled against the gateway. Its own column rather than
    // reusing updatedAt, which every unrelated write bumps — including the per-debit
    // amount_debited increment, which is exactly the write that must NOT count as a fresh sync.
    syncedAt: timestamp("synced_at"),
  },
  (t) => [
    check(
      "reserve_pay_mandates_status_check",
      sql`${t.status} in (${sql.join(
        MANDATE_STATUSES.map((s) => sql`${s}`),
        sql`, `
      )})`
    ),
    // One live mandate per user, enforced in the database: a second concurrent create would
    // otherwise race past the service's pre-check and block the customer's funds twice. Terminal
    // rows are excluded so history accumulates freely.
    uniqueIndex("reserve_pay_mandates_one_live_per_user")
      .on(t.userId)
      .where(
        sql`${t.status} in (${sql.join(
          LIVE_MANDATE_STATUSES.map((s) => sql`${s}`),
          sql`, `
        )})`
      ),
  ]
);

// One row per debit attempt, successful or not — the reconciliation ledger against Razorpay. A
// gateway rejection is a row with the error code, not a dropped exception.
export const reservePayDebits = pgTable(
  "reserve_pay_debits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    mandateId: uuid("mandate_id")
      .notNull()
      .references(() => reservePayMandates.id, { onDelete: "restrict" }),
    // Back-filled once the debit produces an order. Null for a bare test-harness debit, and for
    // the window between a successful charge and the order row existing.
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    razorpayOrderId: text("razorpay_order_id").notNull().unique(),
    razorpayPaymentId: text("razorpay_payment_id"),
    amountPaise: integer("amount_paise").notNull(),
    status: text("status").notNull().default("created"),
    errorCode: text("error_code"),
    errorDescription: text("error_description"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // The reconciliation ledger is always read per mandate.
    index("reserve_pay_debits_mandate_idx").on(t.mandateId),
    check(
      "reserve_pay_debits_status_check",
      sql`${t.status} in (${sql.join(
        RESERVE_PAY_DEBIT_STATUSES.map((s) => sql`${s}`),
        sql`, `
      )})`
    ),
  ]
);
