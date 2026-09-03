/**
 * Server-side mirror of the server -> client half of `web/lib/chat/protocol.ts`, hand-maintained
 * because the two packages share no build. `CHAT_PROTOCOL_VERSION` is the drift detector: bump it
 * on both sides when a part's shape changes, and POST /api/chat rejects a client speaking the old
 * one rather than streaming parts it cannot render.
 *
 * Not mirrored: the widget lifecycle table, `isPartInteractive`, and the WidgetAction -> UI
 * plumbing — rendering concerns. `WidgetAction` itself is, since it arrives as a client turn.
 *
 * MONEY: integer rupees throughout. presenters.ts already converted out of paise; nothing here
 * divides by 100.
 */

// 1 -> 2: OrderReviewPart.payment dropped `tokenId`, which no widget rendered. web/ still
// declares it required, so this mismatch is deliberate — a real client fails loudly with 400
// PROTOCOL_VERSION_MISMATCH rather than receiving a field that is undefined at runtime. Bump
// web/ to 2 per web/issues.md.
//
// 2 -> 3: CartSummaryPart gained `lines`. Without them the widget could only ever show totals,
// while systemPrompt.ts told the model to stay quiet and "let its widget show the detail" — so a
// customer asking what was in their cart got neither.
export const CHAT_PROTOCOL_VERSION = 3;

/** Integer rupees. */
export type Rupees = number;

/* -------------------------------------------------------------------------- */
/* entities carried over the wire                                             */
/* -------------------------------------------------------------------------- */

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
/* actions a widget can emit (client -> server)                               */
/* -------------------------------------------------------------------------- */

export type ReserveMode = "setup" | "top_up";
export type ReserveStep = "choose_amount" | "awaiting_approval" | "confirmed" | "failed";

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
/* message parts (server -> client)                                           */
/* -------------------------------------------------------------------------- */

/**
 * Ops the agent may ask the client to run. Cart ops exist in the frontend union but this backend
 * never emits them — cart state is server-side, so the agent mutates it through `add_to_cart` and
 * the client re-reads; emitting both would double-add. `nav` is the only directive sent.
 */
export type ClientOp =
  | { kind: "cart.add"; productId: string; qty: number }
  | { kind: "cart.set_qty"; itemId: string; qty: number }
  | { kind: "cart.remove"; itemId: string }
  | { kind: "cart.clear" }
  | { kind: "nav"; href: string };

type PartBase = { partId: string };

export type TextPart = PartBase & { type: "text"; text: string; done: boolean };

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
  /** Capped at MAX_PRODUCTS_PER_PART — the transcript is not a catalog page. */
  products: ChatProduct[];
  moreHref?: string;
};

export type CartSummaryPart = PartBase & {
  type: "cart_summary";
  // The widget is the only place cart contents are shown: systemPrompt.ts forbids the model from
  // describing them in text. Empty for a cleared cart.
  lines: ChatCartLine[];
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
  prefill?: Record<string, unknown>;
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
  // No tokenId — see the CHAT_PROTOCOL_VERSION comment above and web/issues.md.
  payment: { method: "reserve_pay"; remaining: Rupees };
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
/* the SSE frames                                                             */
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
