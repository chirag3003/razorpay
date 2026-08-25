import { z } from "zod";

export const initiateCheckoutSchema = z.object({
  addressId: z.uuid(),
  deliverySlot: z.string().min(1, "Select a delivery slot"),
  paymentMethod: z.enum(["upi", "card", "netbanking", "cod"]),
});

export type InitiateCheckoutInput = z.infer<typeof initiateCheckoutSchema>;

export const verifyCheckoutSchema = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

export type VerifyCheckoutInput = z.infer<typeof verifyCheckoutSchema>;
