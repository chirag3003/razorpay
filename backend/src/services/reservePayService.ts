import { randomBytes } from "node:crypto";
import { logger } from "../logger";
import { and, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { reservePayDebits, reservePayMandates, users } from "../db/schema";
import {
  CURRENCY,
  LIVE_MANDATE_STATUSES,
  RESERVE_PAY_DEFAULT_EXPIRY_DAYS,
  RESERVE_PAY_MAX_AMOUNT,
  RESERVE_PAY_MAX_EXPIRY_DAYS,
  RESERVE_PAY_PENDING_TTL_MINUTES,
  RESERVE_PAY_SYNC_FRESHNESS_SECONDS,
} from "../constants";
import {
  ConflictError,
  InsufficientBalanceError,
  MandateAmountExceededError,
  MandateExpiredError,
  MandateNotActiveError,
  NotFoundError,
  PaymentGatewayError,
  PaymentVerificationError,
} from "../errors";
import * as auditService from "./auditService";
import * as paymentService from "./paymentService";
import { gateway } from "./reservePayGateway";
import { buildUpiIntentLinks } from "../utils/upi-intent";
import { maskEmail, maskPhone } from "../utils/mask";
import { pgErrorCode, PG_UNIQUE_VIOLATION } from "../utils/db-error";

// UPI Reserve Pay (single block, multiple debit): guards, persistence, audit. The customer
// approves one block with their UPI PIN; every debit after that is server-to-server with no
// customer interaction, which is what makes AI-initiated ordering possible.
//
// Gateway calls go through reservePayGateway, which is paymentService in real mode and the
// simulator when RESERVE_PAY_SIM is on. Never import /llm — transaction core (Hard Rule #1).

type MandateRow = typeof reservePayMandates.$inferSelect;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Unspent portion of the block. Never negative, even if Razorpay's figures disagree with ours. */
export function remainingPaise(mandate: MandateRow) {
  return Math.max(0, mandate.amountBlockedPaise - mandate.amountDebitedPaise);
}

async function requireUser(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new NotFoundError("User");
  return user;
}

/** Loads a mandate, refusing to serve one belonging to somebody else. */
async function requireOwnedMandate(userId: string, mandateId: string) {
  const [mandate] = await db
    .select()
    .from(reservePayMandates)
    .where(and(eq(reservePayMandates.id, mandateId), eq(reservePayMandates.userId, userId)))
    .limit(1);

  if (!mandate) throw new NotFoundError("Reserve Pay mandate");
  return mandate;
}

/** The caller's live (pending or confirmed) mandate, if they have one. */
export async function getLiveMandate(userId: string) {
  const [mandate] = await db
    .select()
    .from(reservePayMandates)
    .where(
      and(
        eq(reservePayMandates.userId, userId),
        inArray(reservePayMandates.status, [...LIVE_MANDATE_STATUSES])
      )
    )
    .limit(1);

  return mandate ?? null;
}

export async function listMandates(userId: string) {
  return db
    .select()
    .from(reservePayMandates)
    .where(eq(reservePayMandates.userId, userId))
    .orderBy(desc(reservePayMandates.createdAt));
}

/** One Razorpay customer per user, reused forever — a second would orphan earlier tokens. */
async function ensureRazorpayCustomer(user: typeof users.$inferSelect) {
  if (user.razorpayCustomerId) return user.razorpayCustomerId;

  const customerId = await gateway.createRazorpayCustomer({
    name: user.name,
    email: user.email,
    contact: user.phone,
  });

  await db
    .update(users)
    .set({ razorpayCustomerId: customerId })
    .where(eq(users.id, user.id));

  return customerId;
}

/**
 * Creates the authorisation transaction: blocks funds pending the customer's approval. Returns a
 * `pending` mandate plus the UPI deep link. Nothing is debitable until syncMandate picks up the
 * resulting token.
 */
export async function createMandate(
  userId: string,
  input: { amountInRupees: number; expiryDays?: number; replaceExisting?: boolean }
) {
  // Re-asserted rather than trusting the Zod schema: chat and MCP callers reach this service
  // without passing a route validator.
  if (input.amountInRupees <= 0 || input.amountInRupees > RESERVE_PAY_MAX_AMOUNT) {
    throw new MandateAmountExceededError(
      `Reserve Pay blocks are limited to ₹${RESERVE_PAY_MAX_AMOUNT}`
    );
  }

  const expiryDays = Math.min(
    input.expiryDays ?? RESERVE_PAY_DEFAULT_EXPIRY_DAYS,
    RESERVE_PAY_MAX_EXPIRY_DAYS
  );

  // A block cannot be topped up — SBMD blocks a fixed amount once — so "top up" means revoking
  // the old block and creating a bigger one. Revoke first because one_live_per_user forbids two,
  // which also means an abandoned approval leaves the customer with no block but their money
  // back: the safe side, and the same trade releaseAbandonedMandate already makes.
  if (input.replaceExisting) {
    const live = await getLiveMandate(userId);
    if (live) await revokeMandate(userId, live.id, { reason: "replaced_by_top_up" });
  }

  await releaseAbandonedMandate(userId);

  const user = await requireUser(userId);
  // Before the slot claim: creating a customer blocks no funds and is idempotent, so a wasted
  // call costs nothing. Everything after this point can block real money.
  const customerId = await ensureRazorpayCustomer(user);

  const amountPaise = paymentService.toPaise(input.amountInRupees);
  const expiresAt = new Date(Date.now() + expiryDays * MS_PER_DAY);

  // The insert is the atomic slot claim, before the gateway call: a lost race must not leave
  // funds blocked at Razorpay with no local row to track, revoke, or route webhooks to.
  let mandate: MandateRow;
  try {
    const [inserted] = await db
      .insert(reservePayMandates)
      .values({
        userId,
        razorpayCustomerId: customerId,
        maxAmountPaise: amountPaise,
        expiresAt,
        // 256 bits, so the unauthenticated approval page cannot be found by guessing.
        approvalToken: randomBytes(32).toString("base64url"),
      })
      .returning();

    if (!inserted) throw new Error("Failed to create Reserve Pay mandate");
    mandate = inserted;
  } catch (err) {
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
      throw new ConflictError("This account already has an active Reserve Pay mandate.");
    }
    throw err;
  }

  let order;
  let auth;
  try {
    order = await gateway.createReservePayAuthOrder({
      amountPaise,
      customerId,
      receipt: `rp_auth_${Date.now().toString(36)}`,
      // Shown in the customer's UPI app. Razorpay caps the length and rejects special
      // characters — keep it short and plain.
      description: "Agent ordering balance",
      expireAt: Math.floor(expiresAt.getTime() / 1000),
    });

    auth = await gateway.createReservePayAuthPayment({
      amountPaise,
      orderId: order.id,
      customerId,
      contact: user.phone,
      email: user.email,
    });
  } catch (err) {
    // Marked dead, not deleted: the row is the audit trail of an attempt that reached the
    // gateway, and a terminal status releases the per-user slot immediately.
    await db
      .update(reservePayMandates)
      .set({
        status: "failed",
        failureReason: paymentService.describeGatewayError(err),
        updatedAt: new Date(),
      })
      .where(eq(reservePayMandates.id, mandate.id));

    await auditService.log({
      actorType: "user",
      actorId: userId,
      action: "reserve_pay.mandate.create",
      mandateScope: { maxAmountPaise: amountPaise },
      decision: "approved",
      outcome: "failed",
      metadata: {
        mandateId: mandate.id,
        ...paymentService.parseGatewayError(err),
        failureReason: paymentService.describeGatewayError(err),
      },
    });

    throw err;
  }

  const [updated] = await db
    .update(reservePayMandates)
    .set({
      razorpayOrderId: order.id,
      razorpayPaymentId: auth.razorpayPaymentId,
      intentUrl: auth.intentUrl,
      updatedAt: new Date(),
    })
    .where(eq(reservePayMandates.id, mandate.id))
    .returning();

  await auditService.log({
    actorType: "user",
    actorId: userId,
    action: "reserve_pay.mandate.create",
    mandateScope: { maxAmountPaise: amountPaise, expiresAt: expiresAt.toISOString() },
    decision: "approved",
    outcome: "success",
    metadata: {
      mandateId: mandate.id,
      razorpayOrderId: order.id,
      razorpayPaymentId: auth.razorpayPaymentId,
      currency: CURRENCY,
    },
  });

  return present(updated ?? mandate);
}

/**
 * Frees the one-live-mandate-per-user slot after an abandoned attempt — otherwise a customer who
 * closes their UPI app mid-approval holds it forever and every retry answers 409. Syncs first, so
 * a mandate they did approve is recognised rather than discarded.
 */
async function releaseAbandonedMandate(userId: string) {
  const existing = await getLiveMandate(userId);
  if (!existing) return;

  const synced = await syncMandate(existing.id);
  if (!isLive(synced)) return;

  const abandoned =
    synced.status === "pending" &&
    Date.now() - synced.createdAt.getTime() > RESERVE_PAY_PENDING_TTL_MINUTES * 60 * 1000;

  if (!abandoned) {
    throw new ConflictError(
      "This account already has an active Reserve Pay mandate. Revoke it before creating another."
    );
  }

  await db
    .update(reservePayMandates)
    .set({
      status: "expired",
      failureReason: "Authorisation was not completed in time",
      updatedAt: new Date(),
    })
    .where(eq(reservePayMandates.id, synced.id));
}

/** Maps Razorpay's `recurring_details.status` onto our mandate lifecycle. */
function mapRecurringStatus(status: string | undefined): MandateRow["status"] | null {
  switch (status) {
    case "confirmed":
      return "confirmed";
    case "paused":
      return "paused";
    case "initiated":
    case "pending":
      return "pending";
    case "rejected":
    case "failed":
      return "failed";
    case "cancelled":
    case "revoked":
      return "revoked";
    case "expired":
      return "expired";
    case "completed":
      return "exhausted";
    default:
      return null;
  }
}

/**
 * Reconciles a mandate against Razorpay, which is the source of truth for blocked and debited
 * amounts — the per-debit increment is an optimistic write this corrects. Both the polled status
 * endpoint and the webhook handlers call it, so state is mapped in exactly one place.
 */
export async function syncMandate(
  mandateId: string,
  options: { force?: boolean } = {}
) {
  const [mandate] = await db
    .select()
    .from(reservePayMandates)
    .where(eq(reservePayMandates.id, mandateId))
    .limit(1);

  if (!mandate) throw new NotFoundError("Reserve Pay mandate");

  // Terminal states never change again; each sync costs two Razorpay round trips.
  if (!isLive(mandate)) return mandate;

  // Recently reconciled — reuse it. `force` is for callers whose entire purpose is a live read:
  // the approval poll, and the webhook branches, where the webhook IS the signal that something
  // changed. syncedAt is its own column rather than updatedAt precisely so the per-debit
  // amount_debited increment does not read as a fresh sync.
  if (!options.force && mandate.syncedAt) {
    const ageMs = Date.now() - mandate.syncedAt.getTime();
    if (ageMs < RESERVE_PAY_SYNC_FRESHNESS_SECONDS * 1000) return mandate;
  }

  const updates: Partial<typeof reservePayMandates.$inferInsert> = {};
  let tokenId = mandate.razorpayTokenId;

  // The token id exists only once the customer approves; until then the payment carries null.
  if (!tokenId && mandate.razorpayPaymentId) {
    const payment = await gateway.fetchPayment(mandate.razorpayPaymentId);
    tokenId = payment.token_id ?? null;
    if (tokenId) updates.razorpayTokenId = tokenId;

    if (payment.status === "failed") {
      updates.status = "failed";
      updates.failureReason = payment.error_description ?? "Authorisation payment failed";
    }
  }

  if (tokenId) {
    const token = await gateway.fetchCustomerToken(mandate.razorpayCustomerId, tokenId);
    const details = token.recurring_details;

    const mapped = mapRecurringStatus(details?.status);
    if (mapped) updates.status = mapped;
    if (mapped === "confirmed" && !mandate.confirmedAt) updates.confirmedAt = new Date();

    if (details?.failure_reason) updates.failureReason = details.failure_reason;
    if (typeof details?.amount_blocked === "number") {
      updates.amountBlockedPaise = details.amount_blocked;
    } else if ((updates.status ?? mandate.status) === "confirmed") {
      // Razorpay omits amount_blocked on some confirmed UPI tokens. Left at 0 it would make
      // remainingPaise() 0 and reject every debit with no explanation. For SBMD the block
      // equals max_amount.
      updates.amountBlockedPaise =
        mandate.amountBlockedPaise || token.max_amount || mandate.maxAmountPaise;
    }
    if (typeof details?.amount_debited === "number") {
      // Monotonic: Razorpay updates amount_debited asynchronously, so a sync moments after a
      // debit can still report the pre-debit figure. Taking it verbatim would hand back money
      // already spent and pass the next balance check on phantom funds. Also protects the
      // pre-charge reservation, which is local-only until Razorpay catches up.
      updates.amountDebitedPaise = Math.max(mandate.amountDebitedPaise, details.amount_debited);
    }
    if (typeof token.max_amount === "number") updates.maxAmountPaise = token.max_amount;
    if (typeof token.expired_at === "number") {
      updates.expiresAt = new Date(token.expired_at * 1000);
    }
    if (token.vpa) updates.vpa = `${token.vpa.username}@${token.vpa.handle}`;
  }

  const blocked = updates.amountBlockedPaise ?? mandate.amountBlockedPaise;
  const debited = updates.amountDebitedPaise ?? mandate.amountDebitedPaise;
  const status = updates.status ?? mandate.status;
  const expiresAt = updates.expiresAt ?? mandate.expiresAt;

  // Two terminal states Razorpay doesn't always report, derived from its own numbers.
  if (status === "confirmed" && blocked > 0 && debited >= blocked) {
    updates.status = "exhausted";
  } else if (status !== "failed" && expiresAt.getTime() <= Date.now()) {
    updates.status = "expired";
  }

  // syncedAt is stamped even when nothing else changed — "we asked Razorpay and it agreed" is
  // exactly the fact the freshness window needs. updatedAt is only touched when there is a real
  // change, so it keeps meaning what it meant.
  const [updated] = await db
    .update(reservePayMandates)
    .set({
      ...updates,
      ...(Object.keys(updates).length > 0 ? { updatedAt: new Date() } : {}),
      syncedAt: new Date(),
    })
    .where(eq(reservePayMandates.id, mandateId))
    .returning();

  return updated ?? mandate;
}

function isLive(mandate: MandateRow) {
  return (LIVE_MANDATE_STATUSES as readonly string[]).includes(mandate.status);
}

/**
 * The guard chain, in the order backend/CLAUDE.md fixes: confirmed -> not expired -> within the
 * per-transaction cap -> within the remaining balance. Do not reorder: a caller must learn its
 * mandate is dead before it learns anything about balances.
 */
function assertDebitable(mandate: MandateRow, amountPaise: number) {
  if (mandate.status !== "confirmed") {
    throw new MandateNotActiveError(
      mandate.status === "paused"
        ? "Reserve Pay mandate is paused and cannot be debited"
        : `Reserve Pay mandate is ${mandate.status}, not confirmed`
    );
  }

  if (mandate.expiresAt.getTime() <= Date.now()) throw new MandateExpiredError();

  if (amountPaise > mandate.maxAmountPaise) throw new MandateAmountExceededError();

  if (amountPaise > remainingPaise(mandate)) throw new InsufficientBalanceError();
}

/**
 * Reserves funds and creates the Razorpay order, without charging. Split from executeDebit so a
 * caller can record state in the window where no money has moved — checkoutWithReservePay stashes
 * the cart snapshot there.
 */
export async function prepareDebit(params: {
  userId: string;
  amountInRupees: number;
  receipt: string;
  notes?: Record<string, string>;
  /**
   * The mandate a signed quote named. When given, the live mandate must still be that one —
   * otherwise a customer who revoked and recreated their block between the quote and the charge
   * is debited against a block the quote never mentioned, and nothing would notice, because the
   * cart-mandate signature does not cover mandateId.
   */
  expectedMandateId?: string;
}) {
  const live = await getLiveMandate(params.userId);
  if (!live) throw new MandateNotActiveError();

  if (params.expectedMandateId && live.id !== params.expectedMandateId) {
    throw new MandateNotActiveError(
      "The reserved balance this order was quoted against is no longer the live one."
    );
  }

  // Sync first so the balance check runs on Razorpay's figures: a debit whose response was lost
  // still spent the customer's money.
  const mandate = await syncMandate(live.id);
  const amountPaise = paymentService.toPaise(params.amountInRupees);

  // For the error message only — the caller gets the specific domain error (expired vs over-cap
  // vs insufficient). The UPDATE below re-checks the same conditions atomically; that is the
  // correctness guarantee.
  assertDebitable(mandate, amountPaise);

  if (!mandate.razorpayTokenId) throw new MandateNotActiveError();

  // The commit point. One conditional UPDATE means two concurrent debits can't both pass the
  // check above — the second matches no rows, because the first already moved
  // amount_debited_paise.
  const [reserved] = await db
    .update(reservePayMandates)
    .set({
      amountDebitedPaise: sql`${reservePayMandates.amountDebitedPaise} + ${amountPaise}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(reservePayMandates.id, mandate.id),
        eq(reservePayMandates.status, "confirmed"),
        gt(reservePayMandates.expiresAt, new Date()),
        gte(reservePayMandates.maxAmountPaise, amountPaise),
        sql`${reservePayMandates.amountBlockedPaise} - ${reservePayMandates.amountDebitedPaise} >= ${amountPaise}`
      )
    )
    .returning();

  if (!reserved) {
    // Lost the race. Re-run the guard chain so the caller gets a named reason, not a bare
    // conflict.
    assertDebitable(await syncMandate(mandate.id, { force: true }), amountPaise);
    throw new ConflictError("Could not reserve funds against the mandate. Please retry.");
  }

  let order;
  try {
    order = await gateway.createReservePayDebitOrder({
      amountPaise,
      receipt: params.receipt,
      notes: params.notes,
    });
  } catch (err) {
    await releaseReservation(mandate.id, amountPaise);
    throw err;
  }

  // Written before the charge: a debit whose response never arrives still leaves a row carrying
  // the Razorpay order id to reconcile against.
  const [debit] = await db
    .insert(reservePayDebits)
    .values({
      mandateId: mandate.id,
      razorpayOrderId: order.id,
      amountPaise,
      status: "created",
    })
    .returning();

  if (!debit) {
    await releaseReservation(mandate.id, amountPaise);
    throw new Error("Failed to record Reserve Pay debit");
  }

  return { debitId: debit.id, mandateId: mandate.id, amountPaise, razorpayOrderId: order.id };
}

/** Charges a prepared debit. This is the only call in the flow that actually moves money. */
export async function executeDebit(
  debitId: string,
  options: { description?: string; notes?: Record<string, string> } = {}
) {
  const [debit] = await db
    .select()
    .from(reservePayDebits)
    .where(eq(reservePayDebits.id, debitId))
    .limit(1);

  if (!debit) throw new NotFoundError("Reserve Pay debit");

  const [mandate] = await db
    .select()
    .from(reservePayMandates)
    .where(eq(reservePayMandates.id, debit.mandateId))
    .limit(1);

  if (!mandate?.razorpayTokenId) throw new MandateNotActiveError();

  const user = await requireUser(mandate.userId);

  const scope = {
    mandateId: mandate.id,
    maxAmountPaise: mandate.maxAmountPaise,
    remainingPaise: remainingPaise(mandate),
  };

  let payment;
  try {
    payment = await gateway.createReservePayDebitPayment({
      amountPaise: debit.amountPaise,
      orderId: debit.razorpayOrderId,
      customerId: mandate.razorpayCustomerId,
      tokenId: mandate.razorpayTokenId,
      contact: user.phone,
      email: user.email,
      description: options.description,
      notes: options.notes,
    });
  } catch (err) {
    // A decline is a business outcome, not just an exception: persist Razorpay's error code and
    // description, release the reservation, audit, then rethrow. Hard Rule #4 covers failed
    // money-moving attempts too.
    const { code, description } = paymentService.parseGatewayError(err);

    await markDebitOutcome(debit.id, {
      status: "failed",
      errorCode: code,
      errorDescription: description,
    });
    await releaseReservation(mandate.id, debit.amountPaise);

    await auditService.log({
      actorType: "user",
      actorId: mandate.userId,
      action: "reserve_pay.debit",
      mandateScope: scope,
      decision: "approved",
      outcome: "failed",
      metadata: {
        debitId: debit.id,
        razorpayOrderId: debit.razorpayOrderId,
        amountPaise: debit.amountPaise,
        errorCode: code,
        errorDescription: description,
      },
    });

    // paymentService leaves this error unwrapped so the code and description could be
    // persisted above. Now wrapped, so app.onError answers 502 with the gateway's own reason.
    throw new PaymentGatewayError(description ?? "Reserve Pay debit was declined");
  }

  // The headless path verifies the same signature the browser path does — skipping it would mean
  // trusting an unauthenticated response to decide that money moved.
  const verified = paymentService.verifyPaymentSignature({
    razorpayOrderId: payment.razorpay_order_id,
    razorpayPaymentId: payment.razorpay_payment_id,
    razorpaySignature: payment.razorpay_signature,
  });

  if (!verified) {
    await markDebitOutcome(debit.id, {
      status: "failed",
      razorpayPaymentId: payment.razorpay_payment_id,
      errorDescription: "Signature verification failed",
    });

    await auditService.log({
      actorType: "user",
      actorId: mandate.userId,
      action: "reserve_pay.debit",
      mandateScope: scope,
      decision: "rejected",
      outcome: "failed",
      metadata: {
        debitId: debit.id,
        razorpayPaymentId: payment.razorpay_payment_id,
        reason: "signature_verification_failed",
      },
    });

    // Reservation deliberately NOT released: the charge may have succeeded with only its proof
    // suspect, so holding the funds is the safe side. syncMandate reconciles on the next read.
    throw new PaymentVerificationError();
  }

  await markDebitOutcome(debit.id, {
    status: "captured",
    razorpayPaymentId: payment.razorpay_payment_id,
  });

  await auditService.log({
    actorType: "user",
    actorId: mandate.userId,
    action: "reserve_pay.debit",
    mandateScope: scope,
    decision: "approved",
    outcome: "success",
    metadata: {
      debitId: debit.id,
      razorpayOrderId: payment.razorpay_order_id,
      razorpayPaymentId: payment.razorpay_payment_id,
      amountPaise: debit.amountPaise,
    },
  });

  return {
    debitId: debit.id,
    mandateId: mandate.id,
    amountPaise: debit.amountPaise,
    razorpayOrderId: payment.razorpay_order_id,
    razorpayPaymentId: payment.razorpay_payment_id,
  };
}

/**
 * Debits a confirmed mandate in one call. Callers needing to persist state between reserving and
 * charging use prepareDebit/executeDebit directly.
 */
export async function debitFromMandate(params: {
  userId: string;
  amountInRupees: number;
  receipt: string;
  description?: string;
  notes?: Record<string, string>;
}) {
  const prepared = await prepareDebit(params);
  return executeDebit(prepared.debitId, {
    description: params.description,
    notes: params.notes,
  });
}

/**
 * Hands reserved funds back after a failed debit, floored at zero, and un-exhausts the mandate
 * when that frees funds again. Without the un-exhaust, a debit that claims the last of the
 * balance and is then declined leaves the mandate at `exhausted` — terminal, so syncMandate
 * refuses to re-read it — permanently killing a mandate that still holds the customer's money.
 */
export async function releaseReservation(mandateId: string, amountPaise: number) {
  const released = sql`greatest(0, ${reservePayMandates.amountDebitedPaise} - ${amountPaise})`;

  await db
    .update(reservePayMandates)
    .set({
      amountDebitedPaise: released,
      status: sql`case when ${reservePayMandates.status} = 'exhausted'
                        and ${reservePayMandates.amountBlockedPaise} > ${released}
                   then 'confirmed' else ${reservePayMandates.status} end`,
      updatedAt: new Date(),
    })
    .where(eq(reservePayMandates.id, mandateId));
}

/** Links a completed debit to the storefront order it paid for. */
export async function attachOrderToDebit(debitId: string, orderId: string) {
  await db
    .update(reservePayDebits)
    .set({ orderId })
    .where(eq(reservePayDebits.id, debitId));
}

/**
 * Cancels a mandate and releases the remaining blocked funds — a real release via Razorpay's
 * Cancel Token API, not just a local flag.
 *
 * Razorpay forwards to NPCI without extra validation, so cancellation can fail on the remitter's
 * side. It is still marked revoked locally and the gateway's reason recorded, because the
 * alternative is a mandate the customer can neither use nor cancel. Funds still held are
 * auto-reversed by Razorpay 10 minutes before expiry.
 */
export async function revokeMandate(
  userId: string,
  mandateId: string,
  options: { reason?: "customer_request" | "replaced_by_top_up" } = {}
) {
  const mandate = await requireOwnedMandate(userId, mandateId);

  if (!isLive(mandate)) {
    throw new MandateNotActiveError(`Reserve Pay mandate is already ${mandate.status}`);
  }

  let cancellationError: string | null = null;

  if (mandate.razorpayTokenId) {
    try {
      await gateway.cancelReservePayToken(
        mandate.razorpayCustomerId,
        mandate.razorpayTokenId
      );
    } catch (err) {
      cancellationError = paymentService.describeGatewayError(err);
      logger.error("reserve-pay", "token cancellation failed", err, { mandateId });
    }
  }

  const [updated] = await db
    .update(reservePayMandates)
    .set({
      status: "revoked",
      failureReason: cancellationError,
      updatedAt: new Date(),
    })
    .where(eq(reservePayMandates.id, mandateId))
    .returning();

  await auditService.log({
    actorType: "user",
    actorId: userId,
    action: "reserve_pay.mandate.revoke",
    mandateScope: { mandateId, remainingPaise: remainingPaise(mandate) },
    // The local revoke always takes effect; the outcome reflects whether the funds were
    // actually released.
    decision: "approved",
    outcome: cancellationError ? "failed" : "success",
    metadata: {
      mandateId,
      razorpayTokenId: mandate.razorpayTokenId,
      releasedPaise: cancellationError ? 0 : remainingPaise(mandate),
      cancellationError,
      // Separates "the customer cancelled" from "we cancelled to make room for a bigger block",
      // which otherwise look identical in the audit trail.
      reason: options.reason ?? "customer_request",
    },
  });

  return present(updated ?? mandate);
}

/**
 * Re-reads a mandate from Razorpay and returns it. The endpoint clients poll during approval, so
 * it forces a live sync — polling that answers from a cache is not polling.
 */
export async function getMandate(userId: string, mandateId: string) {
  await requireOwnedMandate(userId, mandateId);
  return present(await syncMandate(mandateId, { force: true }));
}

/** Finds the mandate an authorisation order belongs to. Used by the webhook router. */
export async function findMandateByRazorpayOrderId(razorpayOrderId: string) {
  const [mandate] = await db
    .select()
    .from(reservePayMandates)
    .where(eq(reservePayMandates.razorpayOrderId, razorpayOrderId))
    .limit(1);

  return mandate ?? null;
}

/** Finds the debit a charge order belongs to. Used by the webhook router. */
export async function findDebitByRazorpayOrderId(razorpayOrderId: string) {
  const [debit] = await db
    .select()
    .from(reservePayDebits)
    .where(eq(reservePayDebits.razorpayOrderId, razorpayOrderId))
    .limit(1);

  return debit ?? null;
}

/**
 * Which statuses a debit may be moved *out of*, per target status. This is the webhook replay
 * guard: verifyWebhookSignature proves a body came from Razorpay but nothing stops the same signed
 * body being redelivered, and this is the one handler that is not naturally idempotent.
 *
 *   created -> captured | failed   the ordinary outcomes
 *   failed  -> captured            a real capture always wins; a `payment.failed` that arrives or
 *                                  is replayed around a successful capture must not be the last
 *                                  word
 *   captured -> failed             REFUSED. This is the corruption case — a stale payment.failed
 *                                  redelivered after capture would flip the row back and corrupt
 *                                  the reconciliation ledger.
 */
const DEBIT_STATUS_TRANSITIONS = {
  captured: ["created", "failed"],
  failed: ["created"],
} as const;

export async function markDebitOutcome(
  debitId: string,
  outcome: { status: "captured" | "failed"; razorpayPaymentId?: string; errorCode?: string | null; errorDescription?: string | null }
) {
  const allowedFrom = DEBIT_STATUS_TRANSITIONS[outcome.status];

  const updated = await db
    .update(reservePayDebits)
    .set({
      status: outcome.status,
      razorpayPaymentId: outcome.razorpayPaymentId,
      errorCode: outcome.errorCode ?? null,
      errorDescription: outcome.errorDescription ?? null,
    })
    .where(
      and(
        eq(reservePayDebits.id, debitId),
        inArray(reservePayDebits.status, [...allowedFrom])
      )
    )
    .returning({ id: reservePayDebits.id });

  // Not an error: a redelivered webhook, or executeDebit writing `captured` after the webhook
  // already did. Logged because a refused captured -> failed is also how a genuine ordering bug
  // would look, and there would otherwise be no trace of it.
  if (updated.length === 0) {
    logger.warn("reserve-pay", "debit outcome ignored — not a permitted transition", {
      debitId,
      to: outcome.status,
      allowedFrom: allowedFrom.join("|"),
    });
  }
}

/**
 * API shape for a mandate. Amounts in both units: paise because that is what is stored and what
 * reconciles against Razorpay, rupees because that is what the rest of the API speaks.
 */
function present(mandate: MandateRow) {
  return {
    id: mandate.id,
    status: mandate.status,
    maxAmountPaise: mandate.maxAmountPaise,
    amountBlockedPaise: mandate.amountBlockedPaise,
    amountDebitedPaise: mandate.amountDebitedPaise,
    remainingPaise: remainingPaise(mandate),
    amountBlockedInRupees: mandate.amountBlockedPaise / 100,
    remainingInRupees: remainingPaise(mandate) / 100,
    vpa: mandate.vpa,
    failureReason: mandate.failureReason,
    intentUrl: mandate.intentUrl,
    intentLinks: mandate.intentUrl ? buildUpiIntentLinks(mandate.intentUrl) : null,
    // Every caller of present() is owner-scoped, so handing the owner their own approval token is
    // safe. toAgentMandate does not forward it — agents get the built URL, never the raw token.
    approvalToken: mandate.approvalToken,
    expiresAt: mandate.expiresAt,
    confirmedAt: mandate.confirmedAt,
    createdAt: mandate.createdAt,
  };
}

export { present as presentMandate };

/**
 * Everything the unauthenticated approval page renders, and nothing more — no mandate id, user id
 * or Razorpay identifier, and contact details masked, because anyone holding the link sees this.
 *
 * The UPI link is withheld unless the block is still `pending`, so a link that outlives the
 * approval cannot re-offer a live mandate URL. Returns null for an unknown token or a stale
 * attempt, which the route turns into a 404 — the page cannot distinguish the two, by design.
 */
export async function getApprovalView(token: string) {
  const [row] = await db
    .select({ mandate: reservePayMandates, user: users })
    .from(reservePayMandates)
    .innerJoin(users, eq(users.id, reservePayMandates.userId))
    .where(eq(reservePayMandates.approvalToken, token))
    .limit(1);

  if (!row) return null;

  const { mandate, user } = row;

  // Same window createMandate uses to decide a pending block was abandoned, so a link stops
  // working exactly when the attempt behind it stops being resumable.
  const stale =
    mandate.status === "pending" &&
    Date.now() - mandate.createdAt.getTime() > RESERVE_PAY_PENDING_TTL_MINUTES * 60 * 1000;

  if (stale) return null;

  const pending = mandate.status === "pending";

  return {
    status: mandate.status,
    amountInRupees: mandate.maxAmountPaise / 100,
    expiresAt: mandate.expiresAt,
    account: {
      name: user.name,
      email: maskEmail(user.email),
      phone: maskPhone(user.phone),
    },
    intentUrl: pending ? mandate.intentUrl : null,
    intentLinks: pending && mandate.intentUrl ? buildUpiIntentLinks(mandate.intentUrl) : null,
  };
}

/** Re-syncs the mandate behind an approval link, so the page's polling reflects the provider. */
export async function syncByApprovalToken(token: string) {
  const [mandate] = await db
    .select()
    .from(reservePayMandates)
    .where(eq(reservePayMandates.approvalToken, token))
    .limit(1);

  if (mandate) await syncMandate(mandate.id, { force: true });
}

/** Finds a mandate by its Razorpay token id — the key the token.* webhook events carry. */
export async function findMandateByRazorpayTokenId(razorpayTokenId: string) {
  const [mandate] = await db
    .select()
    .from(reservePayMandates)
    .where(eq(reservePayMandates.razorpayTokenId, razorpayTokenId))
    .limit(1);

  return mandate ?? null;
}
