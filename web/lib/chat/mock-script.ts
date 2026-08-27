/**
 * The scripted stand-in for the Growth Agent.
 *
 * Structured as an ordered list of matcher rules rather than a step counter, so
 * the demo survives out-of-order input — a user who types "checkout" before
 * browsing still gets a sensible turn. First match wins; FALLBACK never lets
 * the conversation dead-end.
 *
 * No React and no store imports. Catalog reads go through the real API on
 * purpose: `cart.add` hits the real cart endpoint, so the product ids handed to
 * the transcript must be real ones or adding to cart would 404.
 */

import { getProducts, searchProducts } from "@/lib/api/catalog";
import { DELIVERY_SLOTS } from "@/components/checkout/delivery-slot-picker";
import { formatPrice } from "@/lib/utils";
import { slotLabel, suggestReserveAmount } from "@/lib/chat/format";
import {
  debit,
  getMandate,
  RESERVE_MAX_AMOUNT,
  RESERVE_MAX_VALIDITY_DAYS,
} from "@/lib/chat/mock-reserve-pay";
import type {
  ChatMandate,
  ChatProduct,
  ClientState,
  ClientTurn,
  MessagePart,
  Rupees,
  ServerEvent,
} from "@/lib/chat/protocol";
import type { Product } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* per-conversation memory                                                    */
/* -------------------------------------------------------------------------- */

type Session = {
  addressId?: string;
  addressLabel?: string;
  addressOneLine?: string;
  slotId?: string;
  /** partId of the live Reserve Pay setup widget, so polling can patch it. */
  setupPartId?: string;
  pendingReserveAmount?: Rupees;
};

let session: Session = {};

export function resetMockSession() {
  session = {};
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

let partCounter = 0;
function nextPartId(kind: string): string {
  partCounter += 1;
  return `${kind}-${partCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

function* textPart(text: string): Generator<ServerEvent> {
  const partId = nextPartId("text");
  yield { type: "part_start", part: { type: "text", partId, text: "", done: false } };
  // 2-4 words per chunk; the transport paces them.
  const words = text.split(" ");
  let i = 0;
  while (i < words.length) {
    const size = 2 + Math.floor(Math.random() * 3);
    const chunk = words.slice(i, i + size).join(" ");
    i += size;
    yield { type: "text_delta", partId, delta: i >= words.length ? chunk : `${chunk} ` };
  }
  yield { type: "part_end", partId };
}

function* widget(part: MessagePart): Generator<ServerEvent> {
  yield { type: "part_start", part };
  yield { type: "part_end", partId: part.partId };
}

function toChatProduct(product: Product): ChatProduct {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    unit: product.unit,
    price: product.price,
    mrp: product.mrp,
    image: product.image,
    inStock: product.inStock,
  };
}

async function findProducts(query: string): Promise<ChatProduct[]> {
  try {
    const found = query.trim() ? await searchProducts(query, 6) : [];
    if (found.length > 0) return found.map(toChatProduct);
    const { items } = await getProducts({ pageSize: 6 });
    return items.map(toChatProduct);
  } catch {
    return [];
  }
}

const CATALOG_HINTS = [
  "milk", "bread", "egg", "veg", "fruit", "snack", "rice", "dal", "oil",
  "atta", "butter", "cheese", "curd", "paneer", "tomato", "onion", "potato",
  "banana", "apple", "tea", "coffee", "sugar", "salt", "biscuit", "chocolate",
  "find", "show", "need", "buy", "want", "search", "looking",
];

function textOf(turn: ClientTurn): string {
  if (turn.kind === "text") return turn.text.toLowerCase();
  if (turn.kind === "widget_action" && turn.action.type === "quick_reply") {
    return turn.action.text.toLowerCase();
  }
  return "";
}

function actionType(turn: ClientTurn): string | null {
  return turn.kind === "widget_action" ? turn.action.type : null;
}

const STARTER_CHIPS = {
  type: "quick_replies" as const,
  partId: "",
  options: [
    { id: "veg", label: "Weekly veggies", send: "Show me fresh vegetables" },
    { id: "milk", label: "Milk & eggs", send: "I need milk and eggs" },
    { id: "cart", label: "Show my cart", send: "Show my cart" },
  ],
};

function starterChips(): MessagePart {
  return { ...STARTER_CHIPS, partId: nextPartId("chips") };
}

/* -------------------------------------------------------------------------- */
/* checkout-stage generators (shared by several rules)                        */
/* -------------------------------------------------------------------------- */

function* askForAddress(state: ClientState): Generator<ServerEvent> {
  if (state.addressCount === 0) {
    yield* textPart("I don't have a delivery address for you yet — where should this go?");
    yield* widget({
      type: "address_form",
      partId: nextPartId("addrform"),
      reason: "No saved addresses",
    });
    return;
  }
  yield* textPart("Where should I send it?");
  yield* widget({
    type: "address_picker",
    partId: nextPartId("addrpick"),
    // The store fills `addresses` from the real API before rendering.
    addresses: [],
    selectedId: state.defaultAddressId ?? undefined,
    allowAdd: true,
  });
}

function* askForSlot(): Generator<ServerEvent> {
  yield* textPart("Got it. When would you like it delivered?");
  yield* widget({
    type: "slot_picker",
    partId: nextPartId("slot"),
    slots: DELIVERY_SLOTS.map((slot) => ({ id: slot.id, day: slot.day, time: slot.time })),
    selectedId: session.slotId,
  });
}

function* offerReserveSetup(
  state: ClientState,
  mode: "setup" | "top_up",
  minAmount: Rupees
): Generator<ServerEvent> {
  const partId = nextPartId("reserve");
  session.setupPartId = partId;

  const suggested = suggestReserveAmount(state.cart.total);
  const options = [1_000, 2_500, 5_000, RESERVE_MAX_AMOUNT].filter((a) => a >= minAmount);

  if (mode === "setup") {
    yield* textPart(
      "One-time setup: you reserve an amount with your UPI app, and after that I can pay for orders instantly without you entering a PIN each time."
    );
  } else {
    yield* textPart(
      `Your reserve is short by ${formatPrice(minAmount)}. Top it up and I'll place the order straight away.`
    );
  }

  yield* widget({
    type: "reserve_pay_setup",
    partId,
    mode,
    step: "choose_amount",
    suggestedAmounts: options.length > 0 ? options : [RESERVE_MAX_AMOUNT],
    minAmount,
    maxAmount: RESERVE_MAX_AMOUNT,
    validityDays: RESERVE_MAX_VALIDITY_DAYS,
    amount: suggested,
  });
}

function* showOrderReview(state: ClientState, mandate: ChatMandate): Generator<ServerEvent> {
  const remaining = mandate.amountBlocked - mandate.amountDebited;
  yield* textPart("Here's your order — check it over and I'll charge your reserve.");
  yield* widget({
    type: "order_review",
    partId: nextPartId("review"),
    lines: state.cart.lines,
    address: {
      id: session.addressId ?? "",
      label: session.addressLabel ?? "Delivery",
      oneLine: session.addressOneLine ?? "",
    },
    slot: { id: session.slotId ?? "", label: slotLabel(session.slotId ?? "") },
    totals: {
      subtotal: state.cart.subtotal,
      deliveryFee: state.cart.deliveryFee,
      discount: 0,
      total: state.cart.total,
    },
    payment: { method: "reserve_pay", tokenId: mandate.tokenId, remaining },
    editable: ["cart", "address", "slot"],
  });
}

/** Branches between review, setup, top-up and renewal based on the mandate. */
function* proceedToPayment(state: ClientState): Generator<ServerEvent> {
  const mandate = getMandate();
  const total = state.cart.total;

  if (!mandate || mandate.status === "revoked") {
    yield* offerReserveSetup(state, "setup", total);
    return;
  }

  if (mandate.status === "expired") {
    yield* textPart("Your reserve has expired, so I'll need a fresh one before I can pay.");
    yield* widget({
      type: "reserve_pay_status",
      partId: nextPartId("reservestatus"),
      state: "expired",
      mandate,
      actions: ["renew", "use_web_checkout"],
    });
    return;
  }

  const remaining = mandate.amountBlocked - mandate.amountDebited;
  if (remaining < total) {
    yield* textPart(
      `Your reserve has ${formatPrice(remaining)} left but this order is ${formatPrice(total)}.`
    );
    yield* widget({
      type: "reserve_pay_status",
      partId: nextPartId("reservestatus"),
      state: "insufficient",
      mandate,
      needed: total - remaining,
      actions: ["top_up", "use_web_checkout"],
    });
    return;
  }

  yield* showOrderReview(state, mandate);
}

function* placeOrder(state: ClientState): Generator<ServerEvent> {
  yield* textPart("Charging your reserve…");
  const result = debit(state.cart.total);

  if (!result.ok) {
    yield* widget({
      type: "error",
      partId: nextPartId("err"),
      code: result.code,
      title: "Payment didn't go through",
      actions: [
        { id: "retry", label: "Try again", action: { type: "retry" } },
        {
          id: "web",
          label: "Pay on the website",
          action: { type: "fallback.web_checkout" },
        },
      ],
    });
    return;
  }

  const orderNumber = `FC-${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
  yield* widget({
    type: "order_confirmation",
    partId: nextPartId("confirm"),
    orderNumber,
    total: state.cart.total,
    slotLabel: slotLabel(session.slotId ?? ""),
    addressOneLine: session.addressOneLine ?? "",
    paymentId: result.paymentId,
    debited: result.debited,
    remainingAfter: result.remainingAfter,
    href: "/orders",
  });
  yield {
    type: "part_start",
    part: {
      type: "client_directive",
      partId: nextPartId("dir"),
      op: { kind: "cart.clear" },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* rules                                                                      */
/* -------------------------------------------------------------------------- */

export type Rule = {
  id: string;
  match(turn: ClientTurn, state: ClientState): boolean;
  run(turn: ClientTurn, state: ClientState): AsyncGenerator<ServerEvent>;
};

async function* fromSync(gen: Generator<ServerEvent>): AsyncGenerator<ServerEvent> {
  for (const event of gen) yield event;
}

export const RULES: Rule[] = [
  {
    id: "greeting",
    match: (turn) => turn.kind === "resume",
    async *run() {
      yield* textPart(
        "Hi! I can find groceries, build your cart and check out for you — all from here. What do you need?"
      );
      yield* widget(starterChips());
    },
  },

  {
    id: "show_cart",
    match: (turn) => /\b(my cart|show cart|what's in my cart)\b/.test(textOf(turn)),
    async *run(_turn, state) {
      if (state.cart.itemCount === 0) {
        yield* textPart("Your cart's empty right now. Want me to find something?");
        yield* widget(starterChips());
        return;
      }
      yield* textPart(`You've got ${state.cart.itemCount} item(s) in the cart.`);
      yield* widget({
        type: "cart_summary",
        partId: nextPartId("cart"),
        snapshot: {
          itemCount: state.cart.itemCount,
          subtotal: state.cart.subtotal,
          deliveryFee: state.cart.deliveryFee,
          total: state.cart.total,
        },
        cta: "checkout",
      });
    },
  },

  {
    id: "checkout",
    match: (turn) =>
      actionType(turn) === "cart.checkout" || /\b(check ?out|place.*order|pay)\b/.test(textOf(turn)),
    async *run(_turn, state) {
      if (state.cart.itemCount === 0) {
        yield* textPart("There's nothing in your cart yet — let's fix that first.");
        yield* widget(starterChips());
        return;
      }
      if (!session.addressId) {
        yield* fromSync(askForAddress(state));
        return;
      }
      if (!session.slotId) {
        yield* fromSync(askForSlot());
        return;
      }
      yield* fromSync(proceedToPayment(state));
    },
  },

  {
    id: "address_chosen",
    match: (turn) => {
      const type = actionType(turn);
      return type === "address.select" || type === "address.created";
    },
    async *run(turn) {
      if (turn.kind === "widget_action" && "oneLine" in turn.action) {
        session.addressId = turn.action.addressId;
        session.addressOneLine = turn.action.oneLine;
      }
      yield* fromSync(askForSlot());
    },
  },

  {
    id: "address_add_requested",
    match: (turn) => actionType(turn) === "address.add_requested",
    async *run() {
      yield* textPart("Sure — where should I deliver?");
      yield* widget({ type: "address_form", partId: nextPartId("addrform") });
    },
  },

  {
    id: "slot_chosen",
    match: (turn) => actionType(turn) === "slot.select",
    async *run(turn, state) {
      if (turn.kind === "widget_action" && turn.action.type === "slot.select") {
        session.slotId = turn.action.slotId;
      }
      yield* fromSync(proceedToPayment(state));
    },
  },

  {
    id: "reserve_choose_amount",
    match: (turn) => actionType(turn) === "reserve_pay.choose_amount",
    async *run(turn) {
      if (turn.kind !== "widget_action" || turn.action.type !== "reserve_pay.choose_amount") return;
      const { amount } = turn.action;
      session.pendingReserveAmount = amount;

      const { createMandate } = await import("@/lib/chat/mock-reserve-pay");
      const { upiUri } = createMandate(amount);

      // Patch the SAME widget rather than appending a new bubble.
      const partId = turn.partId;
      session.setupPartId = partId;
      yield {
        type: "part_update",
        partId,
        patch: {
          step: "awaiting_approval",
          amount,
          intent: {
            upiUri,
            expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          },
        },
      };
    },
  },

  {
    id: "reserve_approved",
    match: (turn) => actionType(turn) === "reserve_pay.approved_claim",
    async *run(turn, state) {
      const { approveMandate } = await import("@/lib/chat/mock-reserve-pay");
      const mandate = approveMandate();
      if (turn.kind === "widget_action") {
        yield { type: "part_update", partId: turn.partId, patch: { step: "confirmed" } };
      }
      if (!mandate) {
        yield* textPart("That didn't go through — let's try setting it up again.");
        yield* fromSync(offerReserveSetup(state, "setup", state.cart.total));
        return;
      }
      const remaining = mandate.amountBlocked - mandate.amountDebited;
      yield* textPart(`Reserve is live — ${formatPrice(remaining)} available for the next 90 days.`);
      yield* fromSync(proceedToPayment(state));
    },
  },

  {
    id: "reserve_top_up_or_renew",
    match: (turn) => {
      const type = actionType(turn);
      return type === "reserve_pay.top_up" || type === "reserve_pay.renew";
    },
    async *run(turn, state) {
      const isTopUp = actionType(turn) === "reserve_pay.top_up";
      const mandate = getMandate();
      const remaining = mandate ? mandate.amountBlocked - mandate.amountDebited : 0;
      const needed = isTopUp ? Math.max(0, state.cart.total - remaining) : state.cart.total;
      yield* fromSync(offerReserveSetup(state, isTopUp ? "top_up" : "setup", needed));
    },
  },

  {
    id: "reserve_cancel",
    match: (turn) => actionType(turn) === "reserve_pay.cancel",
    async *run() {
      yield* textPart("No problem — I've left that for now. You can pay on the website instead.");
    },
  },

  {
    id: "confirm_order",
    match: (turn) => {
      const type = actionType(turn);
      return type === "review.confirm" || type === "retry";
    },
    async *run(_turn, state) {
      yield* fromSync(placeOrder(state));
    },
  },

  {
    id: "review_edit",
    match: (turn) => actionType(turn) === "review.edit",
    async *run(turn, state) {
      if (turn.kind !== "widget_action" || turn.action.type !== "review.edit") return;
      if (turn.action.target === "address") {
        session.addressId = undefined;
        yield* fromSync(askForAddress(state));
      } else if (turn.action.target === "slot") {
        session.slotId = undefined;
        yield* fromSync(askForSlot());
      } else {
        yield* textPart("Here's your cart — adjust anything and tell me when you're ready.");
        yield* widget({
          type: "cart_summary",
          partId: nextPartId("cart"),
          snapshot: {
            itemCount: state.cart.itemCount,
            subtotal: state.cart.subtotal,
            deliveryFee: state.cart.deliveryFee,
            total: state.cart.total,
          },
          cta: "checkout",
        });
      }
    },
  },

  {
    id: "catalog_search",
    match: (turn) => {
      const text = textOf(turn);
      return text.length > 0 && CATALOG_HINTS.some((hint) => text.includes(hint));
    },
    async *run(turn) {
      const query = textOf(turn).replace(/\b(show|find|me|i|need|want|buy|looking|for|some)\b/g, "").trim();
      const products = await findProducts(query);

      if (products.length === 0) {
        yield* textPart("I couldn't find anything matching that. Try another search?");
        yield* widget(starterChips());
        return;
      }

      yield* textPart("Here's what I found —");
      yield* widget({
        type: "product_results",
        partId: nextPartId("products"),
        query,
        products,
      });
      yield* widget({
        type: "quick_replies",
        partId: nextPartId("chips"),
        options: [
          { id: "checkout", label: "Check out", send: "Let's check out" },
          { id: "more", label: "Something else", send: "Show me something else" },
        ],
      });
    },
  },
];

export const FALLBACK: Rule = {
  id: "fallback",
  match: () => true,
  async *run() {
    yield* textPart(
      "I can help you find groceries, build a cart and check out. What are you after?"
    );
    yield* widget(starterChips());
  },
};

export function selectRule(turn: ClientTurn, state: ClientState): Rule {
  return RULES.find((rule) => rule.match(turn, state)) ?? FALLBACK;
}
