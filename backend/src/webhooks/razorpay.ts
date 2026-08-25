import { Hono } from "hono";
import * as orderService from "../services/orderService";
import * as paymentService from "../services/paymentService";

export const razorpayWebhook = new Hono();

razorpayWebhook.post("/", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-razorpay-signature") ?? "";

  if (!paymentService.verifyWebhookSignature(rawBody, signature)) {
    return c.json({ error: "Invalid webhook signature" }, 400);
  }

  const body = JSON.parse(rawBody) as {
    event: string;
    payload?: { payment?: { entity?: { id: string; order_id: string } } };
  };

  const payment = body.payload?.payment?.entity;

  switch (body.event) {
    case "payment.captured":
      if (payment) {
        await orderService.confirmPayment(payment.order_id, payment.id);
      }
      break;
    case "payment.failed":
      if (payment) {
        await orderService.cancelPendingCheckout(payment.order_id);
      }
      break;
    default:
      break;
  }

  return c.json({ received: true });
});
