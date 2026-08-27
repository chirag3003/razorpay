import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  check,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { orders } from "./orders";
import {
  LIVE_MANDATE_STATUSES,
  MANDATE_STATUSES,
  RESERVE_PAY_DEBIT_STATUSES,
} from "../../constants";

// UPI Reserve Pay (single block, multiple debit). The customer approves one block in their UPI
// app; we then debit against it server-to-server, with no PIN and no client involvement. This
// is the rail every AI-initiated payment runs on (root claude.md).
//
// Money here is in PAISE, unlike products/carts/orders which are whole rupees. These two tables
// mirror Razorpay entities field-for-field and are reconciled against Razorpay's own values, so
// they carry Razorpay's unit. The `_paise` suffix is load-bearing — never add a bare `amount`
// column to either table.
export const reservePayMandates = pgTable(
  "reserve_pay_mandates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    razorpayCustomerId: text("razorpay_customer_id").notNull(),
    // The authorisation order/payment — the one the customer approves. Distinct from the order
    // created per debit later (those live in reserve_pay_debits). Nullable because the row is
    // inserted *before* Razorpay is called: the insert is what atomically claims this user's
    // one live-mandate slot, so a lost race fails before any funds are blocked.
    razorpayOrderId: text("razorpay_order_id").unique(),
    razorpayPaymentId: text("razorpay_payment_id"),
    // Null until the customer approves in their UPI app; this is the key every debit references.
    razorpayTokenId: text("razorpay_token_id").unique(),
    status: text("status").notNull().default("pending"),
    // token.max_amount — the per-transaction ceiling. For Reserve Pay this equals the block
    // amount, so it doubles as "what we asked to block" before Razorpay confirms the real figure.
    maxAmountPaise: integer("max_amount_paise").notNull(),
    // Mirrored from the token's recurring_details once confirmed. Razorpay is the source of
    // truth for both — reservePayService bumps amountDebitedPaise optimistically on each debit
    // and syncMandate corrects it.
    amountBlockedPaise: integer("amount_blocked_paise").notNull().default(0),
    amountDebitedPaise: integer("amount_debited_paise").notNull().default(0),
    vpa: text("vpa"),
    failureReason: text("failure_reason"),
    // The `upi://mandate` deep link from the authorisation payment. Stored so the status
    // endpoint can hand it back — a customer who closed the app mid-approval needs it again.
    intentUrl: text("intent_url"),
    expiresAt: timestamp("expires_at").notNull(),
    confirmedAt: timestamp("confirmed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "reserve_pay_mandates_status_check",
      sql`${t.status} in (${sql.join(
        MANDATE_STATUSES.map((s) => sql`${s}`),
        sql`, `
      )})`
    ),
    // One live mandate per user, enforced in the database rather than only in the service — a
    // second concurrent POST /api/reserve-pay/mandates would otherwise race past the service's
    // pre-check and block the customer's funds twice. Terminal rows (revoked/expired/failed/
    // exhausted) are excluded so history accumulates freely.
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

// One row per debit attempt, successful or not — the reconciliation ledger against Razorpay and
// the Recovery Agent's future input. A gateway rejection is a row here with the error code, not
// a dropped exception.
export const reservePayDebits = pgTable(
  "reserve_pay_debits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    mandateId: uuid("mandate_id")
      .notNull()
      .references(() => reservePayMandates.id, { onDelete: "restrict" }),
    // Back-filled once the debit has produced a storefront order. Null for a bare debit (the
    // /mandates/:id/debit test harness) and for the window between a successful charge and the
    // order row existing.
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
    check(
      "reserve_pay_debits_status_check",
      sql`${t.status} in (${sql.join(
        RESERVE_PAY_DEBIT_STATUSES.map((s) => sql`${s}`),
        sql`, `
      )})`
    ),
  ]
);
