/**
 * Wire contract for the storefront chat agent.
 *
 * Types only — no React, no store imports, no runtime dependencies beyond the
 * lifecycle table below. The mock transport and the future SSE backend both
 * satisfy this exact shape, which is what makes swapping them a one-file change.
 *
 * MONEY: every monetary value here is an INTEGER NUMBER OF RUPEES, matching
 * `Cart.subtotal`, `Product.price` and what `formatPrice` expects. Paise are a
 * backend concern (only the Razorpay order amount is ever in paise). Mixing the
 * two is the likeliest way to ship a ₹100 → ₹1 bug.
 */

import type { AddressFormValues } from "@/lib/validation";

export const CHAT_PROTOCOL_VERSION = 2;

/** Integer rupees. */
export type Rupees = number;

/* -------------------------------------------------------------------------- */
/* entities carried over the wire                                             */
/* -------------------------------------------------------------------------- */

/**
 * Deliberately NOT `Product` — a denormalised subset, so the wire format stays
 * decoupled from the catalog row and the agent can synthesise results.
 */
export type ChatProduct = {
  id: string;
  slug: string;
  name: string;
  unit: string;
  price: Rupees;
  mrp: Rupees;
  image: string;
  inStock: boolean;
};

export type ChatAddress = {
  id: string;
  label: string;
  oneLine: string;
  isDefault: boolean;
};

export type ChatSlot = {
  id: string;
  day: string;
  time: string;
  disabled?: boolean;
};

export type ChatCartLine = {
  itemId: string;
  productId: string;
  name: string;
  unit: string;
  image: string;
  qty: number;
  price: Rupees;
};

export type MandateStatus = "active" | "expired" | "revoked";

export type ChatMandate = {
  tokenId: string;
  /** Per-transaction ceiling from the token. */
  maxAmount: Rupees;
  amountBlocked: Rupees;
  amountDebited: Rupees;
  /** ISO timestamp. */
  expiredAt: string;
  status: MandateStatus;
};

/* -------------------------------------------------------------------------- */
/* errors                                                                     */
/* -------------------------------------------------------------------------- */

/** Razorpay's documented Reserve Pay failures, plus our transport-level ones. */
export type ChatErrorCode =
  | "insufficient_funds"
  | "payment_declined"
  | "transaction_limit_exceeded"
  | "bank_not_available"
  | "payment_timed_out"
  | "mandate_expired"
  | "mandate_revoked"
  | "reserve_insufficient"
  | "network"
  | "server"
  | "unauthorized";

/* -------------------------------------------------------------------------- */
/* actions a widget can emit                                                  */
/* -------------------------------------------------------------------------- */

export type WidgetAction =
  | { type: "quick_reply"; text: string }
  | { type: "cart.add"; productId: string; name: string; qty: number }
  | { type: "cart.set_qty"; itemId: string; productId: string; qty: number }
  | { type: "cart.remove"; itemId: string; productId: string }
  | { type: "cart.checkout" }
  | { type: "address.select"; addressId: string; oneLine: string }
  | { type: "address.add_requested" }
  | { type: "address.created"; addressId: string; oneLine: string }
  | { type: "slot.select"; slotId: string; label: string }
  | { type: "review.confirm" }
  | { type: "review.edit"; target: "cart" | "address" | "slot" }
  | { type: "reserve_pay.choose_amount"; amount: Rupees; mode: ReserveMode }
  | { type: "reserve_pay.intent_opened" }
  | { type: "reserve_pay.approved_claim" }
  | { type: "reserve_pay.cancel" }
  | { type: "reserve_pay.top_up" }
  | { type: "reserve_pay.renew" }
  | { type: "fallback.web_checkout" }
  | { type: "retry" };

/* -------------------------------------------------------------------------- */
/* message parts                                                              */
/* -------------------------------------------------------------------------- */

export type ReserveMode = "setup" | "top_up";
export type ReserveStep = "choose_amount" | "awaiting_approval" | "confirmed" | "failed";

/** Ops the agent may ask the client to run. Allowlisted — see chat-store. */
export type ClientOp =
  | { kind: "cart.add"; productId: string; qty: number }
  | { kind: "cart.set_qty"; itemId: string; qty: number }
  | { kind: "cart.remove"; itemId: string }
  | { kind: "cart.clear" }
  | { kind: "nav"; href: string };

type PartBase = { partId: string };

export type TextPart = PartBase & {
  type: "text";
  text: string;
  done: boolean;
};

/**
 * Never rendered in the transcript. The store intercepts it, runs the op, and
 * appends a muted one-line note built from `echo`.
 */
export type ClientDirectivePart = PartBase & {
  type: "client_directive";
  op: ClientOp;
  echo?: string;
};

export type QuickRepliesPart = PartBase & {
  type: "quick_replies";
  options: { id: string; label: string; send: string }[];
};

export type ProductResultsPart = PartBase & {
  type: "product_results";
  title?: string;
  query?: string;
  /** Capped at 6 by the agent — the transcript is not a catalog page. */
  products: ChatProduct[];
  moreHref?: string;
};

export type CartSummaryPart = PartBase & {
  type: "cart_summary";
  snapshot: {
    itemCount: number;
    subtotal: Rupees;
    deliveryFee: Rupees;
    total: Rupees;
  };
  cta?: "checkout" | "none";
};

export type AddressPickerPart = PartBase & {
  type: "address_picker";
  addresses: ChatAddress[];
  selectedId?: string;
  allowAdd: boolean;
};

export type AddressFormPart = PartBase & {
  type: "address_form";
  prefill?: Partial<AddressFormValues>;
  reason?: string;
};

export type SlotPickerPart = PartBase & {
  type: "slot_picker";
  slots: ChatSlot[];
  selectedId?: string;
};

export type OrderReviewPart = PartBase & {
  type: "order_review";
  lines: ChatCartLine[];
  address: { id: string; label: string; oneLine: string };
  slot: { id: string; label: string };
  totals: {
    subtotal: Rupees;
    deliveryFee: Rupees;
    discount: Rupees;
    total: Rupees;
  };
  payment: {
    method: "reserve_pay";
    remaining: Rupees;
  };
  editable: ("cart" | "address" | "slot")[];
};

export type ReservePaySetupPart = PartBase & {
  type: "reserve_pay_setup";
  mode: ReserveMode;
  step: ReserveStep;
  suggestedAmounts: Rupees[];
  minAmount: Rupees;
  maxAmount: Rupees;
  validityDays: number;
  amount?: Rupees;
  intent?: { upiUri: string; expiresAt: string };
  failure?: { code: ChatErrorCode; message: string };
};

export type ReservePayStatusPart = PartBase & {
  type: "reserve_pay_status";
  state: "none" | "active" | "expired" | "revoked" | "insufficient";
  mandate?: ChatMandate;
  /** Shortfall, when `state === "insufficient"`. */
  needed?: Rupees;
  actions: ("setup" | "top_up" | "renew" | "use_web_checkout")[];
};

export type OrderConfirmationPart = PartBase & {
  type: "order_confirmation";
  orderNumber: string;
  total: Rupees;
  slotLabel: string;
  addressOneLine: string;
  paymentId: string;
  debited: Rupees;
  remainingAfter: Rupees;
  href: string;
};

export type ErrorPart = PartBase & {
  type: "error";
  code: ChatErrorCode;
  title: string;
  detail?: string;
  actions: { id: string; label: string; action: WidgetAction }[];
};

export type MessagePart =
  | TextPart
  | ClientDirectivePart
  | QuickRepliesPart
  | ProductResultsPart
  | CartSummaryPart
  | AddressPickerPart
  | AddressFormPart
  | SlotPickerPart
  | OrderReviewPart
  | ReservePaySetupPart
  | ReservePayStatusPart
  | OrderConfirmationPart
  | ErrorPart;

export type PartType = MessagePart["type"];

/* -------------------------------------------------------------------------- */
/* messages                                                                   */
/* -------------------------------------------------------------------------- */

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  createdAt: number;
  parts: MessagePart[];
  status: "streaming" | "complete" | "error";
};

/* -------------------------------------------------------------------------- */
/* widget lifecycle — the freeze rule                                         */
/* -------------------------------------------------------------------------- */

/**
 * - `transient` — a conversational commitment (pick an address, pick a slot).
 *   Interactive only while it is the newest unanswered transient part. Once
 *   answered it re-renders as a compact summary, so scrolling back through the
 *   transcript can't re-answer a question that's already been settled.
 * - `live` — reflects current client state, idempotent and reversible. Stays
 *   interactive forever; bumping a quantity on an old product grid is fine
 *   because the stepper reads from the cart store, not from the frozen payload.
 * - `static` — never interactive.
 */
export const WIDGET_LIFECYCLE: Record<PartType, "transient" | "live" | "static"> = {
  text: "static",
  client_directive: "static",
  order_confirmation: "static",
  product_results: "live",
  cart_summary: "live",
  quick_replies: "transient",
  address_picker: "transient",
  address_form: "transient",
  slot_picker: "transient",
  order_review: "transient",
  reserve_pay_setup: "transient",
  reserve_pay_status: "transient",
  error: "transient",
};

export type InteractivityContext = {
  activePartId: string | null;
  resolutions: Record<string, WidgetAction>;
};

export function isPartInteractive(
  part: MessagePart,
  ctx: InteractivityContext
): boolean {
  const lifecycle = WIDGET_LIFECYCLE[part.type];
  if (lifecycle === "static") return false;
  if (lifecycle === "live") return true;
  return part.partId === ctx.activePartId && ctx.resolutions[part.partId] === undefined;
}

/** The last transient part of a message becomes the one awaiting an answer. */
export function lastTransientPartId(parts: MessagePart[]): string | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part && WIDGET_LIFECYCLE[part.type] === "transient") return part.partId;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* client -> server                                                           */
/* -------------------------------------------------------------------------- */

export type ClientTurn =
  | { kind: "text"; text: string }
  | { kind: "widget_action"; partId: string; action: WidgetAction }
  | { kind: "resume" };

export type ClientState = {
  route: string;
  cart: {
    cartId: string | null;
    itemCount: number;
    subtotal: Rupees;
    deliveryFee: Rupees;
    total: Rupees;
    lines: ChatCartLine[];
  };
  addressCount: number;
  defaultAddressId: string | null;
  mandate: ChatMandate | null;
  /** Deferred cart taps since the last turn — cleared once a turn is sent. */
  recentActions: WidgetAction[];
};

export type ChatRequest = {
  conversationId: string;
  token: string;
  turn: ClientTurn;
  clientState: ClientState;
  protocolVersion: number;
};

/* -------------------------------------------------------------------------- */
/* server -> client                                                           */
/* -------------------------------------------------------------------------- */

export type ServerEvent =
  | { type: "message_start"; messageId: string }
  | { type: "part_start"; part: MessagePart }
  | { type: "text_delta"; partId: string; delta: string }
  /** Shallow merge into an already-rendered part — used by Reserve Pay polling. */
  | { type: "part_update"; partId: string; patch: Record<string, unknown> }
  | { type: "part_end"; partId: string }
  | { type: "message_end"; messageId: string }
  | { type: "error"; code: ChatErrorCode; message: string; retryable: boolean };
