import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as reservePayService from "../services/reservePayService";
import * as sim from "../services/reservePaySimService";
import { SIM_TOKEN_STATUSES } from "../db/schema";
import { NotFoundError } from "../errors";
import type { AppEnv } from "../types";

// Demo controls for the Reserve Pay simulator, mounted only when RESERVE_PAY_SIM is on. Every
// route drives the *gateway-side* record; the mandate then moves through the real syncMandate,
// so the lifecycle mapping is exercised rather than bypassed.
//
// Schemas are local rather than in /schemas: the simulator is meant to be deletable as one unit
// the day Razorpay provisions the S2S API.
export const reservePaySimRoutes = new Hono<AppEnv>();

const debitFailureSchema = z.object({
  code: z.string().min(1).default("payment_declined"),
  description: z.string().min(1).default("Payment was unsuccessful as it was declined by your bank."),
});

const tokenStatusSchema = z.object({
  status: z.enum(SIM_TOKEN_STATUSES),
});

/** The caller's own simulated token. Scoped by mandate, so one demo can't touch another's. */
async function callerTokenId(userId: string) {
  const mandate = await reservePayService.getLiveMandate(userId);
  if (!mandate) throw new NotFoundError("Reserve Pay mandate");
  return mandate.razorpayTokenId;
}

// Skips the approval wait for a scripted demo. The chat flow doesn't need this — the token
// confirms itself once RESERVE_PAY_SIM_APPROVAL_DELAY_MS has passed.
reservePaySimRoutes.post("/approve", async (c) => {
  await sim.approveNow(await callerTokenId(c.get("userId")));
  return c.json({ mandate: await currentMandate(c.get("userId")) });
});

reservePaySimRoutes.post("/debit-failure", zValidator("json", debitFailureSchema), async (c) => {
  const { code, description } = c.req.valid("json");
  await sim.armDebitFailure(await callerTokenId(c.get("userId")), code, description);
  return c.json({ armed: { code, description } });
});

reservePaySimRoutes.delete("/debit-failure", async (c) => {
  await sim.disarmDebitFailure(await callerTokenId(c.get("userId")));
  return c.json({ armed: null });
});

reservePaySimRoutes.post("/token-status", zValidator("json", tokenStatusSchema), async (c) => {
  await sim.setTokenStatus(await callerTokenId(c.get("userId")), c.req.valid("json").status);
  return c.json({ mandate: await currentMandate(c.get("userId")) });
});

reservePaySimRoutes.get("/state", async (c) => {
  return c.json(await sim.readState(await callerTokenId(c.get("userId"))));
});

/** Re-reads through syncMandate, so a response shows the mapped result of the change just made. */
async function currentMandate(userId: string) {
  const live = await reservePayService.getLiveMandate(userId);
  return live ? await reservePayService.getMandate(userId, live.id) : null;
}
