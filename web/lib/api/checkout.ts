import { apiFetch } from "@/lib/api/client";
import type { Order } from "@/lib/types";

export type InitiateCheckoutResponse = {
  razorpayOrderId: string;
  amount: number;
  currency: string;
  keyId: string;
};

export function initiateCheckout(
  token: string,
  data: {
    addressId: string;
    deliverySlot: string;
  }
): Promise<InitiateCheckoutResponse> {
  return apiFetch<InitiateCheckoutResponse>("/api/cart/checkout/initiate", {
    method: "POST",
    token,
    body: data,
  });
}

export async function verifyCheckout(
  token: string,
  data: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }
): Promise<Order> {
  const { order } = await apiFetch<{ order: Order }>(
    "/api/cart/checkout/verify",
    { method: "POST", token, body: data }
  );
  return order;
}
