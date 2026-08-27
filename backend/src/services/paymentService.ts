import Razorpay from "razorpay";
import { validatePaymentVerification } from "razorpay/dist/utils/razorpay-utils";
import { razorpay } from "../clients/razorpay";
import { env } from "../config/env";
import { CURRENCY } from "../constants";
import { PaymentGatewayError } from "../errors";

// The only place rupees->paise conversion happens — everything else in the app (products,
// carts, orders) is priced in whole rupees, matching the storefront's own data. Exported for
// reservePayService, whose tables store paise because they mirror Razorpay entities directly.
export function toPaise(amountInRupees: number) {
  return Math.round(amountInRupees * 100);
}

/**
 * Pulls Razorpay's own error fields off a thrown SDK error.
 *
 * Reserve Pay needs more than a message: a declined debit is persisted to reserve_pay_debits
 * with the gateway's `code`/`description` so the failure is a queryable row (and the Recovery
 * Agent's future input) rather than a swallowed exception.
 */
export function parseGatewayError(err: unknown) {
  const error = (err as { error?: { code?: string; description?: string; reason?: string } })
    ?.error;
  return {
    code: error?.code ?? null,
    description: error?.description ?? null,
    reason: error?.reason ?? null,
  };
}

function gatewayError(err: unknown, fallback: string) {
  return new PaymentGatewayError(describeGatewayError(err) ?? fallback);
}

/**
 * Best-effort human-readable reason for a gateway failure, for persisting to a row.
 *
 * Handles both shapes that reach a caller: a raw Razorpay SDK error (fields under `.error`) and
 * one this module already wrapped in a PaymentGatewayError (reason on `.message`). Reading only
 * the first shape silently stores null for every wrapped failure.
 */
export function describeGatewayError(err: unknown) {
  const parsed = parseGatewayError(err);
  if (parsed.description) return parsed.description;
  if (err instanceof PaymentGatewayError) return err.message;
  return null;
}

export async function createRazorpayOrder(params: {
  amountInRupees: number;
  receipt: string;
}) {
  let order;
  try {
    order = await razorpay.orders.create({
      amount: toPaise(params.amountInRupees),
      currency: CURRENCY,
      receipt: params.receipt,
    });
  } catch (err) {
    throw gatewayError(err, "Failed to create Razorpay order");
  }

  return {
    razorpayOrderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: env.RAZORPAY_KEY_ID,
  };
}

export function verifyPaymentSignature(params: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}) {
  return validatePaymentVerification(
    { order_id: params.razorpayOrderId, payment_id: params.razorpayPaymentId },
    params.razorpaySignature,
    env.RAZORPAY_KEY_SECRET
  );
}

export function verifyWebhookSignature(rawBody: string, signature: string) {
  return Razorpay.validateWebhookSignature(
    rawBody,
    signature,
    env.RAZORPAY_WEBHOOK_SECRET
  );
}

// --- UPI Reserve Pay (SBMD) gateway calls --------------------------------------------------
//
// These four calls go through `razorpay.api` — the SDK's own generic HTTP client — rather than
// its resource methods, because the resource methods' types cannot express an SBMD request:
// `orders.create`'s token type (Tokens.RazorpayTokenEmandate) has no `type` field, so
// `single_block_multiple_debit` won't typecheck, and `payments.createPaymentJson` is typed for
// the card flow (it demands `save`, `card`, `ip`, `user_agent`). `razorpay.api.post<Req, Res>`
// is public and generic, prefixes `/v1`, and carries the same basic auth — so we get honest
// hand-written types for these bodies instead of casting through a signature that is wrong.
//
// Everything here is I/O and typing only. The guard chain, persistence, and audit trail live in
// reservePayService, per backend/CLAUDE.md's service-layer rules.

type RazorpayOrderResponse = {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: string;
  created_at: number;
};

// The response to an intent-flow authorisation payment. `next` carries the UPI deep link the
// customer approves in, plus a poll URL we don't use (we poll via payments.fetch instead).
type AuthPaymentResponse = {
  razorpay_payment_id: string;
  next?: Array<{ action: string; url: string }>;
};

// A debit against an existing token comes back already signed, in the same shape the browser
// checkout callback produces — which is why verifyPaymentSignature above works on it unchanged.
type DebitPaymentResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

// Subset of the token entity we actually consume. `recurring_details` is the live state of the
// block: whether the customer approved it, and how much of it is left.
export type RazorpayTokenResponse = {
  id: string;
  token: string;
  method: string;
  vpa: { username: string; handle: string; name: string | null } | null;
  recurring: boolean;
  recurring_details: {
    status: string;
    failure_reason: string | null;
    amount_blocked?: number;
    amount_debited?: number;
  } | null;
  max_amount?: number;
  expired_at?: number;
  used_at: number | null;
  created_at: number;
};

export async function createRazorpayCustomer(params: {
  name: string;
  email: string;
  contact: string;
}) {
  try {
    // fail_existing "0" makes this idempotent against Razorpay's side: if a customer with these
    // details already exists (e.g. we persisted ours and later lost it), we get that one back
    // instead of a 400. Tokens are linked to a customer, so re-creating would orphan them.
    const customer = await razorpay.customers.create({ ...params, fail_existing: 0 });
    return customer.id;
  } catch (err) {
    throw gatewayError(err, "Failed to create Razorpay customer");
  }
}

/**
 * Step 1 of the SBMD chain: the authorisation order that defines the block.
 *
 * `amount`, `token.max_amount` and the authorisation payment's `amount` are all the same figure
 * — the amount being blocked. Razorpay's docs are inconsistent here (some SDK samples pass
 * `amount: 0`), but the worked example's intent URL carries `am=2.00&amrule=MAX` against a
 * 200-paise payment and the resulting token reports `amount_blocked: 200, max_amount: 200`.
 */
export async function createReservePayAuthOrder(params: {
  amountPaise: number;
  customerId: string;
  receipt: string;
  description: string;
  expireAt: number;
}) {
  try {
    return await razorpay.api.post<unknown, RazorpayOrderResponse>({
      url: "/orders",
      data: {
        amount: params.amountPaise,
        currency: CURRENCY,
        method: "upi",
        customer_id: params.customerId,
        receipt: params.receipt,
        description: params.description,
        token: {
          max_amount: params.amountPaise,
          expire_at: params.expireAt,
          frequency: "as_presented",
          type: "single_block_multiple_debit",
        },
      },
    });
  } catch (err) {
    throw gatewayError(err, "Failed to create Reserve Pay authorisation order");
  }
}

/**
 * Step 2: the authorisation payment. Creates a pending token and returns the `upi://mandate`
 * deep link the customer approves with their UPI PIN — the one and only human step in the
 * entire rail.
 */
export async function createReservePayAuthPayment(params: {
  amountPaise: number;
  orderId: string;
  customerId: string;
  contact: string;
  email: string;
}) {
  let response: AuthPaymentResponse;
  try {
    response = await razorpay.api.post<unknown, AuthPaymentResponse>({
      url: "/payments/create/json",
      data: {
        amount: params.amountPaise,
        currency: CURRENCY,
        order_id: params.orderId,
        customer_id: params.customerId,
        contact: params.contact,
        email: params.email,
        method: "upi",
        recurring: true,
        upi: { flow: "intent" },
      },
    });
  } catch (err) {
    throw gatewayError(err, "Failed to create Reserve Pay authorisation payment");
  }

  return {
    razorpayPaymentId: response.razorpay_payment_id,
    intentUrl: response.next?.find((n) => n.action === "intent")?.url ?? null,
  };
}

/**
 * Step 3: the order for a single debit against a confirmed block.
 *
 * Deliberately no `notification` object. The Reserve Pay docs are explicit that it is not
 * supported for this flow ("Skip this parameter entirely"), and passing it would also disable
 * Razorpay's own retry — a failed debit would then need manual re-triggering after a
 * `payment_after` timestamp.
 */
export async function createReservePayDebitOrder(params: {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}) {
  try {
    return await razorpay.api.post<unknown, RazorpayOrderResponse>({
      url: "/orders",
      data: {
        amount: params.amountPaise,
        currency: CURRENCY,
        payment_capture: true,
        receipt: params.receipt,
        notes: params.notes,
      },
    });
  } catch (err) {
    throw gatewayError(err, "Failed to create Reserve Pay debit order");
  }
}

/** Step 4: the debit itself. No customer interaction — this is the headless half of the rail. */
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
  return razorpay.api.post<unknown, DebitPaymentResponse>({
    url: "/payments/create/json",
    data: {
      amount: params.amountPaise,
      currency: CURRENCY,
      order_id: params.orderId,
      customer_id: params.customerId,
      token: params.tokenId,
      recurring: true,
      contact: params.contact,
      email: params.email,
      description: params.description,
      notes: params.notes,
    },
  });
  // No try/catch here on purpose: a declined debit is a business outcome reservePayService has
  // to persist (error code, failed debit row, audit entry) before it rethrows, so it needs the
  // raw error. Every other call in this file fails fast because nothing is recorded yet.
}

/** Reads `token_id` off the authorisation payment once the customer has approved it. */
export async function fetchPayment(paymentId: string) {
  try {
    return await razorpay.payments.fetch(paymentId);
  } catch (err) {
    throw gatewayError(err, "Failed to fetch payment");
  }
}

/** The live state of a block: approval status, amount blocked, amount already drawn down. */
export async function fetchCustomerToken(customerId: string, tokenId: string) {
  try {
    return await razorpay.api.get<unknown, RazorpayTokenResponse>({
      url: `/customers/${customerId}/tokens/${tokenId}`,
    });
  } catch (err) {
    throw gatewayError(err, "Failed to fetch Reserve Pay token");
  }
}

/**
 * Releases a Reserve Pay block. All remaining funds are unblocked and credited back to the
 * customer instantly.
 *
 * Cancellable from the `initiated`, `confirmed` and `paused` states. Razorpay forwards the
 * request to NPCI without additional validation, so it can fail on the remitter's side — the
 * caller decides whether that's fatal.
 *
 * Not to be confused with DELETE on the same resource, which drops the token from Razorpay's
 * records *without* cancelling the mandate, leaving the customer's funds blocked with no way
 * left to release them.
 */
export async function cancelReservePayToken(customerId: string, tokenId: string) {
  return razorpay.api.put<unknown, { id: string; status: string }>({
    url: `/customers/${customerId}/tokens/${tokenId}/cancel`,
  });
}
