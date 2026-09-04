import { z } from "zod";
import { MAX_CART_ITEM_QTY } from "../constants";

// The cap is enforced here AND in cartService.addItem, deliberately. `qty` is additive, so a
// schema bound alone lets two capped requests run one line past the cap and eventually past
// int4 — only the service sees the resulting quantity.

export const addCartItemSchema = z.object({
  productId: z.uuid(),
  qty: z.number().int().positive().max(MAX_CART_ITEM_QTY).default(1),
});

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;

export const updateCartItemSchema = z.object({
  qty: z.number().int().min(0).max(MAX_CART_ITEM_QTY),
});

export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
