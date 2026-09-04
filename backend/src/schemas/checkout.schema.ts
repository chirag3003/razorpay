import { z } from "zod";
import { DELIVERY_SLOT_LABELS, isDeliverySlotLabel } from "../constants";

export const initiateCheckoutSchema = z.object({
  addressId: z.uuid(),
  // The storefront posts the LABEL, not the slot id, so this validates against the labels
  // deliverySlotLabel produces rather than against DELIVERY_SLOTS ids. Previously
  // `z.string().min(1)`, which put arbitrary free text into an order a human has to fulfil.
  deliverySlot: z
    .string()
    .refine(isDeliverySlotLabel, {
      message: `Select a delivery slot. Expected one of: ${DELIVERY_SLOT_LABELS.join(" | ")}`,
    }),
  paymentMethod: z.enum(["upi", "card", "netbanking", "cod"]).optional(),
});

export type InitiateCheckoutInput = z.infer<typeof initiateCheckoutSchema>;

export const verifyCheckoutSchema = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

export type VerifyCheckoutInput = z.infer<typeof verifyCheckoutSchema>;
