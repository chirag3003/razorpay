import { z } from "zod";

/**
 * Validation for `POST /api/chat`.
 *
 * Mirrors the client -> server half of `web/lib/chat/protocol.ts` (`ChatRequest`, `ClientTurn`,
 * `ClientState`, `WidgetAction`). Leaf module per backend/CLAUDE.md — imports nothing but zod.
 *
 * Two deliberate looseness decisions:
 *
 * - `clientState.cart` and `clientState.mandate` are accepted but **not trusted**. The orchestrator
 *   rebuilds both from the database (see llm/turnContext.ts), because a browser can send anything.
 *   They are validated only loosely enough to not 400 a well-behaved client.
 * - `token` is accepted and ignored. The frontend's `ChatRequest` carries it, but this route
 *   authenticates from the `Authorization` header like every other route in the app.
 */

const rupees = z.number().int();

export const widgetActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("quick_reply"), text: z.string().max(500) }),
  z.object({
    type: z.literal("cart.add"),
    productId: z.string(),
    name: z.string(),
    qty: z.number().int(),
  }),
  z.object({
    type: z.literal("cart.set_qty"),
    itemId: z.string(),
    productId: z.string(),
    qty: z.number().int(),
  }),
  z.object({ type: z.literal("cart.remove"), itemId: z.string(), productId: z.string() }),
  z.object({ type: z.literal("cart.checkout") }),
  z.object({
    type: z.literal("address.select"),
    addressId: z.string(),
    oneLine: z.string(),
  }),
  z.object({ type: z.literal("address.add_requested") }),
  z.object({
    type: z.literal("address.created"),
    addressId: z.string(),
    oneLine: z.string(),
  }),
  z.object({ type: z.literal("slot.select"), slotId: z.string(), label: z.string() }),
  z.object({ type: z.literal("review.confirm") }),
  z.object({
    type: z.literal("review.edit"),
    target: z.enum(["cart", "address", "slot"]),
  }),
  z.object({
    type: z.literal("reserve_pay.choose_amount"),
    amount: rupees,
    mode: z.enum(["setup", "top_up"]),
  }),
  z.object({ type: z.literal("reserve_pay.intent_opened") }),
  z.object({ type: z.literal("reserve_pay.approved_claim") }),
  z.object({ type: z.literal("reserve_pay.cancel") }),
  z.object({ type: z.literal("reserve_pay.top_up") }),
  z.object({ type: z.literal("reserve_pay.renew") }),
  z.object({ type: z.literal("fallback.web_checkout") }),
  z.object({ type: z.literal("retry") }),
]);

export type WidgetActionInput = z.infer<typeof widgetActionSchema>;

export const clientTurnSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().min(1).max(2_000) }),
  z.object({
    kind: z.literal("widget_action"),
    partId: z.string(),
    action: widgetActionSchema,
  }),
  z.object({ kind: z.literal("resume") }),
]);

export type ClientTurnInput = z.infer<typeof clientTurnSchema>;

const clientCartSchema = z.object({
  cartId: z.string().nullable().default(null),
  itemCount: z.number().int().default(0),
  subtotal: rupees.default(0),
  deliveryFee: rupees.default(0),
  total: rupees.default(0),
  lines: z.array(z.unknown()).default([]),
});

export const clientStateSchema = z.object({
  route: z.string().default("/"),
  cart: clientCartSchema.prefault({}),
  addressCount: z.number().int().default(0),
  defaultAddressId: z.string().nullable().default(null),
  // Ignored — server truth wins. Present so a compliant client isn't rejected.
  mandate: z.unknown().nullable().default(null),
  /** Cart taps the client deferred since the last turn. Summarised into the model's context. */
  recentActions: z.array(widgetActionSchema).max(50).default([]),
});

export type ClientStateInput = z.infer<typeof clientStateSchema>;

export const chatRequestSchema = z.object({
  conversationId: z.uuid().optional(),
  // Accepted for wire compatibility, never read — auth comes from the Authorization header.
  token: z.string().optional(),
  turn: clientTurnSchema,
  clientState: clientStateSchema.prefault({}),
  protocolVersion: z.number().int(),
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
