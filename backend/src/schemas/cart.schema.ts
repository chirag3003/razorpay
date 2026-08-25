import { z } from "zod";

export const addCartItemSchema = z.object({
  productId: z.uuid(),
  qty: z.number().int().positive().default(1),
});

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;

export const updateCartItemSchema = z.object({
  qty: z.number().int().min(0),
});

export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
