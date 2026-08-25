import Razorpay from "razorpay";
import { validatePaymentVerification } from "razorpay/dist/utils/razorpay-utils";
import { razorpay } from "../clients/razorpay";
import { env } from "../config/env";
import { CURRENCY } from "../constants";
import { PaymentGatewayError } from "../errors";

// The only place rupees->paise conversion happens — everything else in the app (products,
// carts, orders) is priced in whole rupees, matching the storefront's own data.
function toPaise(amountInRupees: number) {
  return Math.round(amountInRupees * 100);
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
    const description =
      (err as { error?: { description?: string } })?.error?.description;
    throw new PaymentGatewayError(description ?? "Failed to create Razorpay order");
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
