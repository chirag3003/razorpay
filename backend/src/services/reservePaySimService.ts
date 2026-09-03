import { createHash, createHmac, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { simPayments, simTokens } from "../db/schema";
import { env } from "../config/env";
import { logger } from "../logger";
import type { RazorpayTokenResponse } from "./paymentService";

// Demo stand-in for Razorpay's Reserve Pay endpoints, used only when RESERVE_PAY_SIM is on.
// It answers the eight gateway calls and nothing else: every guard, reservation, audit write and
// status mapping still runs in reservePayService against these responses.
//
// Two things are deliberately real rather than faked — the payment signature and the webhook
// signature — so verifyPaymentSignature and verifyWebhookSignature genuinely pass instead of
// being bypassed.

type SimTokenRow = typeof simTokens.$inferSelect;

/** Mimics the SDK's normalised failure so parseGatewayError reads it unchanged. */
class SimGatewayError extends Error {
  statusCode = 400;
  error: {
    code: string;
    description: string;
    source: string;
    step: string;
    reason: string;
    metadata: Record<string, string>;
  };

  constructor(code: string, description: string, metadata: Record<string, string> = {}) {
    super(description);
    this.name = "SimGatewayError";
    this.error = { code, description, source: "gateway", step: "payment_initiation", reason: code, metadata };
  }
}

const simId = (prefix: string) => `${prefix}_sim_${randomBytes(7).toString("hex")}`;

/** Two digits, matching the ddmmyyyy the real intent URL carries. */
const upiDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}${d.getFullYear()}`;

/**
 * Shaped like Razorpay's real deep link, including the `am`/`amrule=MAX` pair that carries the
 * block amount. It has to start with `upi://mandate` or buildUpiIntentLinks returns null and the
 * chat widget loses its per-app links.
 */
function buildIntentUri(paymentId: string, amountPaise: number, expiresAt: Date) {
  const params = new URLSearchParams({
    pa: "sim.rzprec@simbank",
    pn: "Quick Commerce",
    mn: "Create Mandate",
    tid: `SIM${randomBytes(8).toString("hex").toUpperCase()}`,
    validitystart: upiDate(new Date()),
    validityend: upiDate(expiresAt),
    am: (amountPaise / 100).toFixed(2),
    amrule: "MAX",
    recur: "ASPRESENTED",
    tr: `${paymentId}create1`,
    url: "",
    cu: "INR",
    mc: "4900",
    tn: "MANDATE",
    orgid: "180100",
    mode: "04",
    purpose: "77",
    txnType: "CREATE",
    rev: "N",
    block: "Y",
  });

  return `upi://mandate?${params.toString()}`;
}

// --- webhook playback ------------------------------------------------------------------------

/**
 * Posts a correctly signed event to this server's own webhook route, so the async reconciliation
 * path runs for real. Best-effort: a restart loses the pending send, and nothing depends on it —
 * the polling path reaches the same state on its own.
 */
async function sendWebhook(event: string, payload: Record<string, unknown>) {
  const body = JSON.stringify({ event, payload });
  const signature = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(body).digest("hex");

  try {
    const res = await fetch(`http://localhost:${env.PORT}/webhooks/razorpay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-razorpay-signature": signature },
      body,
    });
    if (!res.ok) logger.error("sim", `webhook ${event} rejected`, undefined, { status: res.status });
  } catch (err) {
    logger.error("sim", `webhook ${event} failed to send`, err);
  }
}

function schedule(delayMs: number, run: () => Promise<void>) {
  if (!env.RESERVE_PAY_SIM_WEBHOOKS) return;
  setTimeout(() => void run(), delayMs + env.RESERVE_PAY_SIM_WEBHOOK_DELAY_MS);
}

const paymentEntity = (id: string, orderId: string) => ({ payment: { entity: { id, order_id: orderId } } });

// --- token state -----------------------------------------------------------------------------

/**
 * Reads a token, promoting it from pending to confirmed once its approval moment has passed.
 * Resolving by timestamp rather than a timer keeps the transition correct across the restarts
 * `bun --watch` causes, and makes it observable by whoever reads next rather than needing a live
 * process at the exact moment.
 */
async function resolveToken(tokenId: string): Promise<SimTokenRow | null> {
  const [token] = await db.select().from(simTokens).where(eq(simTokens.id, tokenId)).limit(1);
  if (!token) return null;

  if (token.status !== "pending" || token.confirmAt.getTime() > Date.now()) return token;

  const [confirmed] = await db
    .update(simTokens)
    .set({ status: "confirmed", vpa: "9876543210@simbank" })
    .where(eq(simTokens.id, tokenId))
    .returning();

  return confirmed ?? token;
}

// --- the eight gateway calls -----------------------------------------------------------------

/** Derived from the email so the same user keeps one customer id across restarts and reseeds. */
export async function createRazorpayCustomer(params: {
  name: string;
  email: string;
  contact: string;
}) {
  const hash = createHash("sha256").update(params.email).digest("hex").slice(0, 14);
  return `cust_sim_${hash}`;
}

export async function createReservePayAuthOrder(params: {
  amountPaise: number;
  customerId: string;
  receipt: string;
  description: string;
  expireAt: number;
}) {
  return { id: simId("order") };
}

/**
 * The authorisation. Creates the token in `pending` with its approval moment already fixed, and
 * returns the deep link the customer would open. The block becomes debitable only once
 * RESERVE_PAY_SIM_APPROVAL_DELAY_MS has elapsed, so the first status poll honestly reports
 * pending the way the real flow does.
 */
export async function createReservePayAuthPayment(params: {
  amountPaise: number;
  orderId: string;
  customerId: string;
  contact: string;
  email: string;
}) {
  const tokenId = simId("token");
  const paymentId = simId("pay");
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const confirmAt = new Date(Date.now() + env.RESERVE_PAY_SIM_APPROVAL_DELAY_MS);

  await db.insert(simTokens).values({
    id: tokenId,
    customerId: params.customerId,
    status: "pending",
    confirmAt,
    maxAmountPaise: params.amountPaise,
    amountBlockedPaise: params.amountPaise,
    expiredAt: expiresAt,
  });

  await db.insert(simPayments).values({
    id: paymentId,
    orderId: params.orderId,
    tokenId,
    status: "created",
  });

  // payment.captured first: its handler resolves the mandate by order id and syncs, which is what
  // writes the token id that token.confirmed then resolves against.
  schedule(env.RESERVE_PAY_SIM_APPROVAL_DELAY_MS, async () => {
    await sendWebhook("payment.captured", paymentEntity(paymentId, params.orderId));
    await sendWebhook("token.confirmed", {
      token: { entity: { id: tokenId } },
      ...paymentEntity(paymentId, params.orderId),
    });
  });

  return {
    razorpayPaymentId: paymentId,
    intentUrl: buildIntentUri(paymentId, params.amountPaise, expiresAt),
  };
}

/** The token id is present from creation, matching the real API where it precedes approval. */
export async function fetchPayment(paymentId: string) {
  const [payment] = await db
    .select()
    .from(simPayments)
    .where(eq(simPayments.id, paymentId))
    .limit(1);

  if (!payment) throw new SimGatewayError("BAD_REQUEST_ERROR", "The id provided does not exist");

  return {
    token_id: payment.tokenId,
    status: payment.status,
    error_description: payment.errorDescription,
  };
}

export async function fetchCustomerToken(
  customerId: string,
  tokenId: string
): Promise<RazorpayTokenResponse> {
  const token = await resolveToken(tokenId);
  if (!token) throw new SimGatewayError("BAD_REQUEST_ERROR", "No db records found.");

  const [username, handle] = (token.vpa ?? "").split("@");

  return {
    id: token.id,
    token: token.id.replace("token_sim_", ""),
    method: "upi",
    vpa: token.vpa ? { username: username ?? "", handle: handle ?? "", name: "SIM CUSTOMER" } : null,
    recurring: true,
    recurring_details: {
      status: token.status,
      failure_reason: null,
      // Nothing is blocked until the customer approves, so these are absent while pending —
      // otherwise a mandate reports spendable balance before it is debitable.
      ...(token.status === "pending"
        ? {}
        : {
            amount_blocked: token.amountBlockedPaise,
            amount_debited: token.amountDebitedPaise,
          }),
    },
    max_amount: token.maxAmountPaise,
    expired_at: Math.floor(token.expiredAt.getTime() / 1000),
    used_at: token.amountDebitedPaise > 0 ? Math.floor(Date.now() / 1000) : null,
    created_at: Math.floor(token.createdAt.getTime() / 1000),
  };
}

export async function createReservePayDebitOrder(params: {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}) {
  return { id: simId("order") };
}

/**
 * The debit. Honours an armed failure first — disarming it, so one arming produces exactly one
 * decline — then draws down the token and returns a genuinely signed payment.
 */
export async function createReservePayDebitPayment(params: {
  amountPaise: number;
  orderId: string;
  customerId: string;
  tokenId: string;
  contact: string;
  email: string;
  description?: string;
  notes?: Record<string, string>;
}) {
  const token = await resolveToken(params.tokenId);
  if (!token) throw new SimGatewayError("BAD_REQUEST_ERROR", "No db records found.");

  if (token.status !== "confirmed") {
    throw new SimGatewayError("payment_declined", `Mandate is ${token.status}, not confirmed`);
  }

  if (token.nextDebitErrorCode) {
    await db
      .update(simTokens)
      .set({ nextDebitErrorCode: null, nextDebitErrorDescription: null })
      .where(eq(simTokens.id, token.id));

    const paymentId = simId("pay");
    const description = token.nextDebitErrorDescription ?? "Payment was unsuccessful";

    await db.insert(simPayments).values({
      id: paymentId,
      orderId: params.orderId,
      tokenId: token.id,
      status: "failed",
      errorCode: token.nextDebitErrorCode,
      errorDescription: description,
    });

    schedule(0, () =>
      sendWebhook("payment.failed", {
        payment: {
          entity: {
            id: paymentId,
            order_id: params.orderId,
            error_code: token.nextDebitErrorCode,
            error_description: description,
          },
        },
      })
    );

    throw new SimGatewayError(token.nextDebitErrorCode, description);
  }

  if (params.amountPaise > token.amountBlockedPaise - token.amountDebitedPaise) {
    throw new SimGatewayError("payment_declined", "Debit exceeds the amount blocked on the mandate");
  }

  await db
    .update(simTokens)
    .set({ amountDebitedPaise: sql`${simTokens.amountDebitedPaise} + ${params.amountPaise}` })
    .where(eq(simTokens.id, token.id));

  const paymentId = simId("pay");
  await db.insert(simPayments).values({
    id: paymentId,
    orderId: params.orderId,
    tokenId: token.id,
    status: "captured",
  });

  schedule(0, () => sendWebhook("payment.captured", paymentEntity(paymentId, params.orderId)));

  return {
    razorpay_payment_id: paymentId,
    razorpay_order_id: params.orderId,
    // The real signature over the real payload, so executeDebit's verification is a live check.
    razorpay_signature: createHmac("sha256", env.RAZORPAY_KEY_SECRET)
      .update(`${params.orderId}|${paymentId}`)
      .digest("hex"),
  };
}

export async function cancelReservePayToken(customerId: string, tokenId: string) {
  const [cancelled] = await db
    .update(simTokens)
    .set({ status: "cancelled" })
    .where(eq(simTokens.id, tokenId))
    .returning();

  if (!cancelled) throw new SimGatewayError("BAD_REQUEST_ERROR", "No db records found.");

  schedule(0, () => sendWebhook("token.cancelled", { token: { entity: { id: tokenId } } }));

  return { id: tokenId, status: "cancelled" };
}

// --- control surface, used by /api/reserve-pay/sim ---------------------------------------------

/** The token behind a mandate, for the sim control endpoints. */
async function requireToken(tokenId: string | null) {
  if (!tokenId) throw new SimGatewayError("BAD_REQUEST_ERROR", "Mandate has no simulated token yet");
  const [token] = await db.select().from(simTokens).where(eq(simTokens.id, tokenId)).limit(1);
  if (!token) throw new SimGatewayError("BAD_REQUEST_ERROR", "No db records found.");
  return token;
}

/** Short-circuits the approval delay. */
export async function approveNow(tokenId: string | null) {
  const token = await requireToken(tokenId);
  await db
    .update(simTokens)
    .set({ status: "confirmed", confirmAt: new Date(), vpa: "9876543210@simbank" })
    .where(eq(simTokens.id, token.id));
}

export async function armDebitFailure(
  tokenId: string | null,
  code: string,
  description: string
) {
  const token = await requireToken(tokenId);
  await db
    .update(simTokens)
    .set({ nextDebitErrorCode: code, nextDebitErrorDescription: description })
    .where(eq(simTokens.id, token.id));
}

export async function disarmDebitFailure(tokenId: string | null) {
  const token = await requireToken(tokenId);
  await db
    .update(simTokens)
    .set({ nextDebitErrorCode: null, nextDebitErrorDescription: null })
    .where(eq(simTokens.id, token.id));
}

/** Sets the gateway-side status; syncMandate then maps it onto our lifecycle as usual. */
export async function setTokenStatus(tokenId: string | null, status: string) {
  const token = await requireToken(tokenId);
  await db.update(simTokens).set({ status }).where(eq(simTokens.id, token.id));
}

export async function readState(tokenId: string | null) {
  if (!tokenId) return { token: null, payments: [] };

  const [token] = await db.select().from(simTokens).where(eq(simTokens.id, tokenId)).limit(1);
  const payments = await db.select().from(simPayments).where(eq(simPayments.tokenId, tokenId));

  return { token: token ?? null, payments };
}
