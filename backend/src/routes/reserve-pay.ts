import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createMandateSchema, debitMandateSchema } from "../schemas/reserve-pay.schema";
import * as reservePayService from "../services/reservePayService";
import { reservePaySimRoutes } from "./reserve-pay-sim";
import { requireAuth } from "../middleware/auth";
import { env } from "../config/env";
import type { AppEnv } from "../types";

// UPI Reserve Pay mandates. Authorising a block is the one step needing a human; everything
// downstream — checkout, chat, MCP — debits headlessly against the token it produces.
export const reservePayRoutes = new Hono<AppEnv>();

reservePayRoutes.use("*", requireAuth);

// Registered only in simulator mode, rather than registered and then guarded — a control that
// can move a mandate's status should not exist as a route at all in a real deployment.
if (env.RESERVE_PAY_SIM) {
  reservePayRoutes.route("/sim", reservePaySimRoutes);
}

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
//
// Registered only when RESERVE_PAY_TEST_DEBIT_ROUTE is on, rather than registered and then
// guarded — same reasoning as the /sim block above. This one moves *real* money against real
// keys and any authenticated user can call it, so it should not exist as a route at all in a
// real deployment.
if (env.RESERVE_PAY_TEST_DEBIT_ROUTE) {
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
}
