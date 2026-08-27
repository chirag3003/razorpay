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
import { buildUpiIntentLinks } from "../utils/upi-intent";
import { pgErrorCode, PG_UNIQUE_VIOLATION } from "../utils/db-error";

// UPI Reserve Pay (single block, multiple debit).
//
// The customer authorises one block with their UPI PIN; after that every purchase is a
// server-to-server debit against that block with no customer interaction at all. That headless
// half is what makes AI-initiated ordering possible — a chat interface or an external agent
// cannot drive a Razorpay Checkout popup.
//
// This file owns the flow: guards, persistence, audit. The raw gateway calls live in
// paymentService (backend/CLAUDE.md: one place touches Razorpay). Per root Hard Rule #1 this
// file must never import from /llm — it is transaction core, and it stays deterministic.

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

/**
 * Razorpay links recurring tokens to a customer, so a user gets exactly one Razorpay customer
 * that every mandate they ever create hangs off. Creating a second would orphan earlier tokens.
 */
async function ensureRazorpayCustomer(user: typeof users.$inferSelect) {
  if (user.razorpayCustomerId) return user.razorpayCustomerId;

  const customerId = await paymentService.createRazorpayCustomer({
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
 * Creates the authorisation transaction: blocks funds pending the customer's approval.
 *
 * Returns a `pending` mandate plus the UPI deep link the customer has to approve. Nothing is
 * debitable until they do and syncMandate picks up the resulting token.
 */
export async function createMandate(
  userId: string,
  input: { amountInRupees: number; expiryDays?: number }
) {
  // Re-asserted here rather than trusting the Zod schema: this service is the shared layer, and
  // the chat/agent callers arriving in the next phase won't come through a route validator.
  if (input.amountInRupees <= 0 || input.amountInRupees > RESERVE_PAY_MAX_AMOUNT) {
    throw new MandateAmountExceededError(
      `Reserve Pay blocks are limited to ₹${RESERVE_PAY_MAX_AMOUNT}`
    );
  }

  const expiryDays = Math.min(
    input.expiryDays ?? RESERVE_PAY_DEFAULT_EXPIRY_DAYS,
    RESERVE_PAY_MAX_EXPIRY_DAYS
  );

  await releaseAbandonedMandate(userId);

  const user = await requireUser(userId);
  // Before the slot claim on purpose: creating a customer blocks no funds and is idempotent
  // (fail_existing "0"), so a wasted call here costs nothing. Everything after this point can
  // block real money, which is why the DB row comes first.
  const customerId = await ensureRazorpayCustomer(user);

  const amountPaise = paymentService.toPaise(input.amountInRupees);
  const expiresAt = new Date(Date.now() + expiryDays * MS_PER_DAY);

  // The insert is the atomic slot claim. Doing it before the gateway call is what stops a lost
  // race from leaving the customer with funds blocked at Razorpay and no local row to track,
  // revoke, or route webhooks to — an orphan we could neither see nor release.
  let mandate: MandateRow;
  try {
    const [inserted] = await db
      .insert(reservePayMandates)
      .values({
        userId,
        razorpayCustomerId: customerId,
        maxAmountPaise: amountPaise,
        expiresAt,
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
    order = await paymentService.createReservePayAuthOrder({
      amountPaise,
      customerId,
      receipt: `rp_auth_${Date.now().toString(36)}`,
      // Shown to the customer inside their UPI app while they approve. Razorpay caps this and
      // rejects special characters, so keep it short and plain.
      description: "Agent ordering balance",
      expireAt: Math.floor(expiresAt.getTime() / 1000),
    });

    auth = await paymentService.createReservePayAuthPayment({
      amountPaise,
      orderId: order.id,
      customerId,
      contact: user.phone,
      email: user.email,
    });
  } catch (err) {
    // Mark the claim dead rather than deleting it: the row is the audit trail of an attempt
    // that reached the gateway, and a terminal status releases the per-user slot immediately.
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
 * Frees the one-live-mandate-per-user slot when the previous attempt was abandoned.
 *
 * Without this a customer who opens the UPI approval link and then closes their app holds the
 * slot forever — every retry answers 409 and they can never set Reserve Pay up. Syncs first, so
 * a mandate they actually did approve is recognised rather than thrown away.
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
 * Reconciles a mandate against Razorpay. Razorpay is the source of truth for the blocked and
 * debited amounts — our per-debit increment is an optimistic write that this corrects.
 *
 * Both the status endpoint (polled while the customer is approving in their UPI app) and the
 * webhook handlers call this, so mandate state is mapped in exactly one place.
 */
export async function syncMandate(mandateId: string) {
  const [mandate] = await db
    .select()
    .from(reservePayMandates)
    .where(eq(reservePayMandates.id, mandateId))
    .limit(1);

  if (!mandate) throw new NotFoundError("Reserve Pay mandate");

  // Terminal states never change again, and every sync costs two Razorpay round-trips.
  if (!isLive(mandate)) return mandate;

  const updates: Partial<typeof reservePayMandates.$inferInsert> = {};
  let tokenId = mandate.razorpayTokenId;

  // The token id only exists once the customer approves; until then the payment carries a null.
  if (!tokenId && mandate.razorpayPaymentId) {
    const payment = await paymentService.fetchPayment(mandate.razorpayPaymentId);
    tokenId = payment.token_id ?? null;
    if (tokenId) updates.razorpayTokenId = tokenId;

    if (payment.status === "failed") {
      updates.status = "failed";
      updates.failureReason = payment.error_description ?? "Authorisation payment failed";
    }
  }

  if (tokenId) {
    const token = await paymentService.fetchCustomerToken(mandate.razorpayCustomerId, tokenId);
    const details = token.recurring_details;

    const mapped = mapRecurringStatus(details?.status);
    if (mapped) updates.status = mapped;
    if (mapped === "confirmed" && !mandate.confirmedAt) updates.confirmedAt = new Date();

    if (details?.failure_reason) updates.failureReason = details.failure_reason;
    if (typeof details?.amount_blocked === "number") {
      updates.amountBlockedPaise = details.amount_blocked;
    } else if ((updates.status ?? mandate.status) === "confirmed") {
      // Razorpay omits amount_blocked on some confirmed UPI tokens. Leaving it at 0 would make
      // remainingPaise() 0 and reject every debit with INSUFFICIENT_BLOCKED_BALANCE and no
      // explanation anywhere. For SBMD the block equals max_amount, which we know.
      updates.amountBlockedPaise =
        mandate.amountBlockedPaise || token.max_amount || mandate.maxAmountPaise;
    }
    if (typeof details?.amount_debited === "number") {
      // Monotonic on purpose. Razorpay updates amount_debited asynchronously, so a sync run
      // moments after a debit can still report the pre-debit figure — taking it verbatim would
      // hand back money we already spent and let the next balance check pass on phantom funds.
      // It also protects the pre-charge reservation, which is local-only until Razorpay catches up.
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

  // Two terminal states Razorpay doesn't always report explicitly, derived from its own numbers.
  if (status === "confirmed" && blocked > 0 && debited >= blocked) {
    updates.status = "exhausted";
  } else if (status !== "failed" && expiresAt.getTime() <= Date.now()) {
    updates.status = "expired";
  }

  if (Object.keys(updates).length === 0) return mandate;

  const [updated] = await db
    .update(reservePayMandates)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(reservePayMandates.id, mandateId))
    .returning();

  return updated ?? mandate;
}

function isLive(mandate: MandateRow) {
  return (LIVE_MANDATE_STATUSES as readonly string[]).includes(mandate.status);
}

/**
 * The guard chain, run in the order backend/CLAUDE.md fixes: confirmed -> not expired/revoked ->
 * within the per-transaction cap -> within the remaining balance. Do not reorder — a caller
 * should learn its mandate is dead before it learns anything about balances.
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
 * Reserves funds and creates the Razorpay order for a debit, without charging anything yet.
 *
 * Split from executeDebit so a caller that needs to record state between reserving and charging
 * — checkoutWithReservePay does, it has to stash the cart snapshot — can do so inside a window
 * where no money has moved.
 */
export async function prepareDebit(params: {
  userId: string;
  amountInRupees: number;
  receipt: string;
  notes?: Record<string, string>;
}) {
  const live = await getLiveMandate(params.userId);
  if (!live) throw new MandateNotActiveError();

  // Sync first so the balance check runs on Razorpay's figures, not on a local count that may
  // have drifted — a debit whose response we lost still spent the customer's money.
  const mandate = await syncMandate(live.id);
  const amountPaise = paymentService.toPaise(params.amountInRupees);

  // Runs first so the caller gets the *specific* domain error (expired vs over-cap vs
  // insufficient) in the order backend/CLAUDE.md fixes. The UPDATE below re-checks the same
  // conditions atomically; this is for the error message, that is for correctness.
  assertDebitable(mandate, amountPaise);

  if (!mandate.razorpayTokenId) throw new MandateNotActiveError();

  // The real commit point. Drawing down the ledger in one conditional UPDATE means two
  // concurrent debits can't both pass the check above and lose one of the drawdowns — the
  // second one matches no rows because the first already moved amount_debited_paise.
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
    // Lost the race. Re-read and re-run the guard chain so the caller still gets a named reason
    // rather than a bare conflict.
    assertDebitable(await syncMandate(mandate.id), amountPaise);
    throw new ConflictError("Could not reserve funds against the mandate. Please retry.");
  }

  let order;
  try {
    order = await paymentService.createReservePayDebitOrder({
      amountPaise,
      receipt: params.receipt,
      notes: params.notes,
    });
  } catch (err) {
    await releaseReservation(mandate.id, amountPaise);
    throw err;
  }

  // Written before the charge, so a debit whose response never arrives still leaves a row
  // carrying the razorpay order id to reconcile against.
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
    payment = await paymentService.createReservePayDebitPayment({
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
    // A decline is a business outcome, not just an exception: persist Razorpay's own error code
    // and description, hand the reserved funds back, then audit before rethrowing. Root Hard
    // Rule #4 covers failed money-moving attempts too, and the Recovery Agent reads these rows.
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

    // The raw SDK error is deliberately left unwrapped by paymentService so the code and
    // description above could be persisted. Now that they are, convert it into a domain error so
    // app.onError answers 502 with the gateway's own reason rather than a blank 500.
    throw new PaymentGatewayError(description ?? "Reserve Pay debit was declined");
  }

  // The headless path verifies the same signature the browser path does. Skipping it here —
  // on the flow whose whole claim is "bounded, gated, auditable" — would mean trusting an
  // unauthenticated response to decide that money moved.
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

    // Reservation deliberately NOT released: the charge may well have succeeded and only its
    // proof is suspect. Holding the funds is the safe side of that ambiguity, and syncMandate
    // reconciles against Razorpay's own figure on the next read.
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
 * Debits a confirmed mandate in one call — the headless payment primitive.
 *
 * Callers that need to persist something between reserving and charging should use
 * prepareDebit/executeDebit directly instead.
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
 * Hands reserved funds back after a debit fails. Floored at zero.
 *
 * Also un-exhausts the mandate when the release makes funds available again. prepareDebit
 * reserves *before* charging, so a debit that claims the last of the balance and then gets
 * declined would otherwise leave syncMandate's `debited >= blocked` rule holding the mandate at
 * `exhausted` — a terminal status that syncMandate refuses to re-read — permanently killing a
 * mandate that still has the customer's money in it.
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
 * Cancels a mandate and releases the customer's remaining blocked funds.
 *
 * Razorpay's Cancel Token API unblocks everything still held and credits it back to the
 * customer instantly, so this is a real release, not just a local flag. Razorpay forwards the
 * request to NPCI without extra validation and it can fail on the remitter's side — when that
 * happens we still mark the mandate revoked locally (we will not debit it again) and record the
 * gateway's reason, because the alternative is a mandate the customer can neither use nor
 * cancel. If the funds are still held, Razorpay auto-reverses them 10 minutes before expiry.
 */
export async function revokeMandate(userId: string, mandateId: string) {
  const mandate = await requireOwnedMandate(userId, mandateId);

  if (!isLive(mandate)) {
    throw new MandateNotActiveError(`Reserve Pay mandate is already ${mandate.status}`);
  }

  let cancellationError: string | null = null;

  if (mandate.razorpayTokenId) {
    try {
      await paymentService.cancelReservePayToken(
        mandate.razorpayCustomerId,
        mandate.razorpayTokenId
      );
    } catch (err) {
      cancellationError = paymentService.describeGatewayError(err);
      console.error(`Reserve Pay token cancellation failed for mandate ${mandateId}:`, err);
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
    // The local revoke always takes effect; the outcome reflects whether the customer's funds
    // were actually released, which is the part that matters to them.
    decision: "approved",
    outcome: cancellationError ? "failed" : "success",
    metadata: {
      mandateId,
      razorpayTokenId: mandate.razorpayTokenId,
      releasedPaise: cancellationError ? 0 : remainingPaise(mandate),
      cancellationError,
    },
  });

  return present(updated ?? mandate);
}

/** Re-reads a mandate from Razorpay and returns it. The endpoint clients poll during approval. */
export async function getMandate(userId: string, mandateId: string) {
  await requireOwnedMandate(userId, mandateId);
  return present(await syncMandate(mandateId));
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

export async function markDebitOutcome(
  debitId: string,
  outcome: { status: "captured" | "failed"; razorpayPaymentId?: string; errorCode?: string | null; errorDescription?: string | null }
) {
  await db
    .update(reservePayDebits)
    .set({
      status: outcome.status,
      razorpayPaymentId: outcome.razorpayPaymentId,
      errorCode: outcome.errorCode ?? null,
      errorDescription: outcome.errorDescription ?? null,
    })
    .where(eq(reservePayDebits.id, debitId));
}

/**
 * API shape for a mandate. Amounts are echoed in both units — paise because that is what we
 * store and what reconciles against Razorpay, rupees because that is what the rest of the API
 * speaks — and the intent link is expanded per UPI app so a client can skip the app chooser.
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
    expiresAt: mandate.expiresAt,
    confirmedAt: mandate.confirmedAt,
    createdAt: mandate.createdAt,
  };
}

export { present as presentMandate };

/** Finds a mandate by its Razorpay token id — the key the token.* webhook events carry. */
export async function findMandateByRazorpayTokenId(razorpayTokenId: string) {
  const [mandate] = await db
    .select()
    .from(reservePayMandates)
    .where(eq(reservePayMandates.razorpayTokenId, razorpayTokenId))
    .limit(1);

  return mandate ?? null;
}
