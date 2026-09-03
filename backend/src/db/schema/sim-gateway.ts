import { pgTable, text, integer, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Demo-mode stand-in for Razorpay's own records, used only when RESERVE_PAY_SIM is on. These
// tables ARE the pretend gateway: syncMandate reconciles reserve_pay_mandates against them the
// same way it reconciles against Razorpay, so the two stores stay genuinely independent.
//
// Statuses here are Razorpay's `recurring_details.status` vocabulary, not our mandate
// lifecycle — reservePayService.mapRecurringStatus translates between them.
export const SIM_TOKEN_STATUSES = [
  "pending",
  "confirmed",
  "paused",
  "rejected",
  "cancelled",
  "expired",
  "completed",
] as const;

export type SimTokenStatus = (typeof SIM_TOKEN_STATUSES)[number];

export const simTokens = pgTable(
  "sim_tokens",
  {
    // `token_sim_…`, so a simulated id is never mistaken for a Razorpay one in a log or audit row.
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull(),
    status: text("status").notNull().default("pending"),
    // The approval moment, resolved by comparison at read time rather than by a timer: a timer
    // would not survive the constant restarts under `bun --watch`.
    confirmAt: timestamp("confirm_at").notNull(),
    maxAmountPaise: integer("max_amount_paise").notNull(),
    amountBlockedPaise: integer("amount_blocked_paise").notNull(),
    amountDebitedPaise: integer("amount_debited_paise").notNull().default(0),
    vpa: text("vpa"),
    expiredAt: timestamp("expired_at").notNull(),
    // Armed by the sim control endpoint; consumed by the next debit, which then disarms it.
    nextDebitErrorCode: text("next_debit_error_code"),
    nextDebitErrorDescription: text("next_debit_error_description"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "sim_tokens_status_check",
      sql`${t.status} in (${sql.join(
        SIM_TOKEN_STATUSES.map((s) => sql`${s}`),
        sql`, `
      )})`
    ),
  ]
);

// The authorisation payment and every debit payment. `tokenId` is what syncMandate reads first,
// mirroring the real API where the payment carries the token id.
export const simPayments = pgTable("sim_payments", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  tokenId: text("token_id"),
  status: text("status").notNull().default("created"),
  errorCode: text("error_code"),
  errorDescription: text("error_description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
