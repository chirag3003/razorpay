import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createMandateSchema, debitMandateSchema } from "../schemas/reserve-pay.schema";
import * as reservePayService from "../services/reservePayService";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

// UPI Reserve Pay mandates. Authorising a block is the one step needing a human; everything
// downstream — checkout, chat, MCP — debits headlessly against the token it produces.
export const reservePayRoutes = new Hono<AppEnv>();

reservePayRoutes.use("*", requireAuth);

reservePayRoutes.post("/mandates", zValidator("json", createMandateSchema), async (c) => {
  const mandate = await reservePayService.createMandate(c.get("userId"), c.req.valid("json"));
  return c.json({ mandate }, 201);
});

reservePayRoutes.get("/mandates", async (c) => {
  const mandates = await reservePayService.listMandates(c.get("userId"));
  return c.json({ mandates: mandates.map(reservePayService.presentMandate) });
});

// Must stay registered above GET /mandates/:id — Hono matches in declaration order, so the
// dynamic route would otherwise swallow "current" as an id.
reservePayRoutes.get("/mandates/current", async (c) => {
  const live = await reservePayService.getLiveMandate(c.get("userId"));
  if (!live) return c.json({ mandate: null });

  return c.json({ mandate: await reservePayService.getMandate(c.get("userId"), live.id) });
});

// Writes as well as reads — it re-syncs against Razorpay before responding, which is what makes
// it the endpoint to poll while the customer approves in their UPI app.
reservePayRoutes.get("/mandates/:id", async (c) => {
  const mandate = await reservePayService.getMandate(c.get("userId"), c.req.param("id"));
  return c.json({ mandate });
});

// Cancels at Razorpay (unblocking the remaining funds instantly) and marks it revoked locally.
reservePayRoutes.post("/mandates/:id/revoke", async (c) => {
  const mandate = await reservePayService.revokeMandate(c.get("userId"), c.req.param("id"));
  return c.json({ mandate });
});

// Test harness: charges the caller's own mandate with no order, to exercise the rail end to end
// without the cart path. Real purchases go through POST /api/cart/checkout/reserve-pay, which
// creates an order row for the money it moves.
reservePayRoutes.post("/mandates/debit", zValidator("json", debitMandateSchema), async (c) => {
  const input = c.req.valid("json");
  const result = await reservePayService.debitFromMandate({
    userId: c.get("userId"),
    amountInRupees: input.amountInRupees,
    receipt: `rp_test_${Date.now()}`,
    description: input.description ?? "Reserve Pay test debit",
  });
  return c.json(result, 201);
});
