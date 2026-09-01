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
 * Three kinds of Razorpay order — browser checkout, Reserve Pay authorisation, Reserve Pay debit
 * — arrive on the same webhook. Dispatching on order id first is what keeps them apart.
 *
 * Without it, a Reserve Pay authorisation reaches confirmPayment, which throws NotFoundError when
 * no cart matches; that answers 404, and Razorpay retries any non-2xx indefinitely.
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
      // Usually a no-op: checkoutWithReservePay already created the order and confirmPayment
      // short-circuits on it. It matters when the debit succeeded but the insert didn't.
      await confirmIfCheckoutPending(payment);
      return;

    case "cart":
      await confirmIfCheckoutPending(payment);
  }
}

// NotFoundError here means the payment isn't one with a tracked checkout (a bare test debit, a
// dashboard-created payment), not an error worth a non-2xx. Swallow that one case only.
async function confirmIfCheckoutPending(payment: WebhookPayment) {
  try {
    await orderService.confirmPayment(payment.order_id, payment.id);
  } catch (err) {
    if ((err as { code?: string })?.code === "NOT_FOUND") return;
    throw err;
  }
}

/**
 * The token id alone isn't enough for the first event: a mandate's token id is only learned by
 * fetching the authorisation payment, so on the first `token.confirmed` there is nothing stored
 * to match. These events carry the authorisation payment too, so fall back to its order id.
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
      // syncMandate reads the reason off the payment itself rather than the webhook payload.
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

  // Razorpay retries any non-2xx, so an unhandled throw becomes an infinite redelivery loop. Log
  // and acknowledge: syncMandate reconciles anything missed the next time the mandate is read.
  try {
    switch (body.event) {
      // Both matter: a Reserve Pay authorisation commonly reports `authorized` rather than
      // `captured`, and its payment entity is the most reliable carrier of the token id.
      case "payment.authorized":
      case "payment.captured":
        if (payment) await handlePaymentCaptured(payment);
        break;

      case "payment.failed":
        if (payment) await handlePaymentFailed(payment);
        break;

      // All four funnel into syncMandate, so Razorpay's state is mapped in exactly one place.
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
