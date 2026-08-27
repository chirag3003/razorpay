import { Hono } from "hono";
import * as orderService from "../services/orderService";
import * as paymentService from "../services/paymentService";
import * as reservePayService from "../services/reservePayService";

export const razorpayWebhook = new Hono();

type WebhookPayment = {
  id: string;
  order_id: string;
  error_code?: string | null;
  error_description?: string | null;
};

type WebhookToken = { id: string };

type WebhookBody = {
  event: string;
  payload?: {
    payment?: { entity?: WebhookPayment };
    token?: { entity?: WebhookToken };
  };
};

/**
 * Resolves which flow a payment belongs to.
 *
 * There are now three kinds of Razorpay order in this system — a browser checkout, a Reserve Pay
 * authorisation, and a Reserve Pay debit — and they arrive on the same webhook. Dispatching on
 * order id before doing anything is what keeps them apart.
 *
 * This also fixes a real bug: `payment.captured` previously went straight to confirmPayment,
 * which throws NotFoundError("Checkout session") when no cart matches. That escaped to
 * app.onError and answered 404, and Razorpay retries any non-2xx indefinitely. Every Reserve Pay
 * authorisation payment is exactly that case — captured, with an order id no cart will ever own.
 */
async function resolveSource(razorpayOrderId: string) {
  const mandate = await reservePayService.findMandateByRazorpayOrderId(razorpayOrderId);
  if (mandate) return { kind: "mandate" as const, mandate };

  const debit = await reservePayService.findDebitByRazorpayOrderId(razorpayOrderId);
  if (debit) return { kind: "debit" as const, debit };

  return { kind: "cart" as const };
}

async function handlePaymentCaptured(payment: WebhookPayment) {
  const source = await resolveSource(payment.order_id);

  switch (source.kind) {
    case "mandate":
      // The customer approved the block. syncMandate picks up the token and the blocked amount.
      await reservePayService.syncMandate(source.mandate.id);
      return;

    case "debit":
      await reservePayService.markDebitOutcome(source.debit.id, {
        status: "captured",
        razorpayPaymentId: payment.id,
      });
      // Usually a no-op — checkoutWithReservePay already created the order synchronously and
      // confirmPayment short-circuits on the existing row. It matters in the one bad window:
      // the debit succeeded but the order insert didn't, and this is the retry.
      await confirmIfCheckoutPending(payment);
      return;

    case "cart":
      await confirmIfCheckoutPending(payment);
  }
}

// confirmPayment throws NotFoundError when no cart holds this razorpay order id. For a webhook
// that isn't an error worth a non-2xx — it just means the payment isn't one we track a checkout
// for (a bare test debit, a dashboard-created payment). Swallow that one case only.
async function confirmIfCheckoutPending(payment: WebhookPayment) {
  try {
    await orderService.confirmPayment(payment.order_id, payment.id);
  } catch (err) {
    if ((err as { code?: string })?.code === "NOT_FOUND") return;
    throw err;
  }
}

/**
 * Finds the mandate a token.* event belongs to.
 *
 * The token id alone isn't enough for the first one: we only learn a mandate's token id by
 * fetching the authorisation payment, so on the very first `token.confirmed` — the event that
 * matters most — we have nothing stored to match against. These events carry the authorisation
 * payment alongside the token, so fall back to resolving by its order id.
 */
async function resolveMandateForTokenEvent(
  token: WebhookToken | undefined,
  payment: WebhookPayment | undefined
) {
  if (token) {
    const byToken = await reservePayService.findMandateByRazorpayTokenId(token.id);
    if (byToken) return byToken;
  }

  if (payment) return reservePayService.findMandateByRazorpayOrderId(payment.order_id);

  return null;
}

async function handlePaymentFailed(payment: WebhookPayment) {
  const source = await resolveSource(payment.order_id);

  switch (source.kind) {
    case "mandate":
      // The customer declined, or the bank rejected the block. syncMandate reads the authoritative
      // reason off the payment itself rather than trusting the webhook payload.
      await reservePayService.syncMandate(source.mandate.id);
      return;

    case "debit":
      await reservePayService.markDebitOutcome(source.debit.id, {
        status: "failed",
        errorCode: payment.error_code,
        errorDescription: payment.error_description,
      });
      return;

    case "cart":
      await orderService.cancelPendingCheckout(payment.order_id);
  }
}

razorpayWebhook.post("/", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-razorpay-signature") ?? "";

  if (!paymentService.verifyWebhookSignature(rawBody, signature)) {
    return c.json({ error: "Invalid webhook signature" }, 400);
  }

  const body = JSON.parse(rawBody) as WebhookBody;
  const payment = body.payload?.payment?.entity;
  const token = body.payload?.token?.entity;

  // Razorpay retries any non-2xx, so an unhandled throw here becomes an infinite redelivery
  // loop. Log it and acknowledge instead: the payload is already durable on Razorpay's side, and
  // syncMandate reconciles anything we missed the next time the mandate is read.
  try {
    switch (body.event) {
      // Both events matter. A Reserve Pay authorisation commonly reports as `authorized` rather
      // than `captured`, and its payment entity is the most reliable carrier of the token id —
      // the token.* events carry only the token entity, with no order or customer to route on.
      case "payment.authorized":
      case "payment.captured":
        if (payment) await handlePaymentCaptured(payment);
        break;

      case "payment.failed":
        if (payment) await handlePaymentFailed(payment);
        break;

      // Mandate lifecycle. All four funnel into syncMandate so Razorpay's state is mapped onto
      // ours in exactly one place, rather than once per event name.
      case "token.confirmed":
      case "token.rejected":
      case "token.cancelled":
      case "token.paused": {
        const mandate = await resolveMandateForTokenEvent(token, payment);
        if (mandate) await reservePayService.syncMandate(mandate.id);
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(`Razorpay webhook handler failed for event ${body.event}:`, err);
  }

  return c.json({ received: true });
});
