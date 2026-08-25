import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { addCartItemSchema, updateCartItemSchema } from "../schemas/cart.schema";
import { initiateCheckoutSchema, verifyCheckoutSchema } from "../schemas/checkout.schema";
import * as cartService from "../services/cartService";
import * as orderService from "../services/orderService";
import * as paymentService from "../services/paymentService";
import { PaymentVerificationError } from "../errors";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const cartRoutes = new Hono<AppEnv>();

cartRoutes.use("*", requireAuth);

cartRoutes.get("/", async (c) => {
  const cartId = await cartService.getOrCreateActiveCartId(c.get("userId"));
  const cart = await cartService.getCartWithTotals(cartId);
  return c.json(cart);
});

cartRoutes.post("/items", zValidator("json", addCartItemSchema), async (c) => {
  const cartId = await cartService.getOrCreateActiveCartId(c.get("userId"));
  const { productId, qty } = c.req.valid("json");
  await cartService.addItem(cartId, productId, qty);
  return c.json(await cartService.getCartWithTotals(cartId), 201);
});

cartRoutes.patch(
  "/items/:itemId",
  zValidator("json", updateCartItemSchema),
  async (c) => {
    const cartId = await cartService.getOrCreateActiveCartId(c.get("userId"));
    await cartService.updateItemQty(cartId, c.req.param("itemId"), c.req.valid("json").qty);
    return c.json(await cartService.getCartWithTotals(cartId));
  }
);

cartRoutes.delete("/items/:itemId", async (c) => {
  const cartId = await cartService.getOrCreateActiveCartId(c.get("userId"));
  await cartService.removeItem(cartId, c.req.param("itemId"));
  return c.json(await cartService.getCartWithTotals(cartId));
});

cartRoutes.delete("/", async (c) => {
  const cartId = await cartService.getOrCreateActiveCartId(c.get("userId"));
  await cartService.clearCartItems(cartId);
  return c.json(await cartService.getCartWithTotals(cartId));
});

cartRoutes.post(
  "/checkout/initiate",
  zValidator("json", initiateCheckoutSchema),
  async (c) => {
    const result = await orderService.initiateCheckout(c.get("userId"), c.req.valid("json"));
    return c.json(result);
  }
);

cartRoutes.post(
  "/checkout/verify",
  zValidator("json", verifyCheckoutSchema),
  async (c) => {
    const input = c.req.valid("json");
    const valid = paymentService.verifyPaymentSignature(input);

    if (!valid) {
      await orderService.recordFailedVerification(input.razorpayOrderId);
      throw new PaymentVerificationError();
    }

    const order = await orderService.confirmPayment(
      input.razorpayOrderId,
      input.razorpayPaymentId
    );
    return c.json({ order });
  }
);
