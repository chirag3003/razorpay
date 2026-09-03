import { Hono } from "hono";
import * as reservePayService from "../services/reservePayService";
import { RESERVE_PAY_DEFAULT_EXPIRY_DAYS } from "../constants";

// The customer-facing approval page for a block an agent set up. Deliberately its own router:
// reservePayRoutes applies requireAuth to "*", and this is the one Reserve Pay surface that must
// work for someone who is not signed in — an agent sends the link to a person, not a session.
//
// The 32-byte approval token is the only credential. It grants exactly one thing: seeing a masked
// summary and the UPI link the customer must still approve with their own PIN, so a leaked link
// cannot move money on its own.
export const reservePayApprovalRoutes = new Hono();

reservePayApprovalRoutes.get("/:token", async (c) => {
  const token = c.req.param("token");

  // Refresh from the provider before reading, so the page's polling reports an approval that
  // landed via the customer's UPI app rather than waiting for something else to sync it.
  await reservePayService.syncByApprovalToken(token);

  const view = await reservePayService.getApprovalView(token);

  // One 404 for unknown, expired and abandoned alike — a caller holding a guess learns nothing
  // about whether the token existed.
  if (!view) return c.json({ error: "This approval link is no longer valid.", code: "NOT_FOUND" }, 404);

  return c.json({ ...view, validityDays: RESERVE_PAY_DEFAULT_EXPIRY_DAYS });
});
