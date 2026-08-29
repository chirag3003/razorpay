import { env } from "../config/env";
import {
  RESERVE_PAY_DEFAULT_EXPIRY_DAYS,
  RESERVE_PAY_MAX_AMOUNT,
  RESERVE_PAY_MIN_AMOUNT,
  suggestReserveAmounts,
} from "../constants";
import type { ToolError, ToolResult } from "../agent-interfaces/tools/types";
import type {
  ChatErrorCode,
  ErrorPart,
  MessagePart,
  ProductResultsPart,
} from "./protocol";

/**
 * Tool result -> rendered widget. The projection layer.
 *
 * The model is never given "UI tools" (`show_product_results` and friends). When a tool returns,
 * this table decides what the customer sees, built from the tool's own data. Two consequences,
 * both deliberate:
 *
 * - **The model cannot misquote a price.** Every rupee on screen came out of Postgres via the
 *   tool layer. That is root claude.md's Hard Rule #1 ("no LLM in the merchant transaction core")
 *   applied to the UI as well as to the debit.
 * - **Catalog data never round-trips through the model**, which is most of the token cost of a
 *   naive chat agent.
 *
 * The model still chooses *what to fetch* — through its tool arguments — and *what to say*.
 *
 * Shapes here must match web/lib/chat/protocol.ts exactly; see chat/protocol.ts for the mirror
 * and the CHAT_PROTOCOL_VERSION drift check.
 */

/** The transcript is not a catalog page. */
const MAX_PRODUCTS_PER_PART = 6;

let partCounter = 0;
export function nextPartId(kind: string): string {
  partCounter += 1;
  return `${kind}-${partCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

/* -------------------------------------------------------------------------- */
/* errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Tool failure codes -> the frontend's narrower ChatErrorCode union.
 *
 * The tool codes were named to make this mapping mechanical (see tools/types.ts). Where the
 * frontend has no equivalent — `cart_empty`, `invalid_address`, `quote_expired` — the answer is
 * `server` and the *model* explains it in prose, because those are conversational problems the
 * assistant can talk its way out of, not payment failures needing a red box.
 */
const ERROR_CODE_MAP: Record<string, ChatErrorCode> = {
  mandate_missing: "server",
  mandate_expired: "mandate_expired",
  mandate_revoked: "mandate_revoked",
  reserve_insufficient: "reserve_insufficient",
  amount_exceeds_mandate_limit: "transaction_limit_exceeded",
  payment_declined: "payment_declined",
  payment_gateway_unavailable: "bank_not_available",
};

/**
 * Which tool failures deserve a rendered error card at all.
 *
 * Most do not. `not_found`, `cart_empty` and `invalid_input` are things the model recovers from
 * on its own using the failure's `hint` — showing the customer a red box for "that slug doesn't
 * exist" while the assistant is already fixing it is noise. Only failures the *customer* has to
 * act on get a widget.
 */
const CUSTOMER_FACING_ERRORS = new Set([
  "mandate_expired",
  "mandate_revoked",
  "reserve_insufficient",
  "amount_exceeds_mandate_limit",
  "payment_declined",
  "payment_gateway_unavailable",
]);

const ERROR_TITLES: Record<string, string> = {
  mandate_expired: "Your reserved balance has expired",
  mandate_revoked: "Your reserved balance is no longer active",
  reserve_insufficient: "Not enough reserved balance",
  amount_exceeds_mandate_limit: "This order is over your per-order limit",
  payment_declined: "The payment did not go through",
  payment_gateway_unavailable: "The payment provider is unavailable",
};

function errorActions(error: ToolError): ErrorPart["actions"] {
  const webCheckout = {
    id: "web",
    label: "Use normal checkout",
    action: { type: "fallback.web_checkout" as const },
  };

  switch (error.code) {
    case "reserve_insufficient":
      return [
        { id: "top_up", label: "Top up", action: { type: "reserve_pay.top_up" as const } },
        webCheckout,
      ];
    case "mandate_expired":
    case "mandate_revoked":
      return [
        { id: "renew", label: "Set up again", action: { type: "reserve_pay.renew" as const } },
        webCheckout,
      ];
    case "payment_declined":
      // Never offer a retry here. The registry marks this non-retryable because the charge may
      // in fact have succeeded and only its proof is suspect — retrying risks a second debit.
      return [webCheckout];
    default:
      return error.retryable
        ? [{ id: "retry", label: "Try again", action: { type: "retry" as const } }, webCheckout]
        : [webCheckout];
  }
}

export function toErrorPart(error: ToolError): ErrorPart | null {
  if (!CUSTOMER_FACING_ERRORS.has(error.code)) return null;

  return {
    type: "error",
    partId: nextPartId("error"),
    code: ERROR_CODE_MAP[error.code] ?? "server",
    title: ERROR_TITLES[error.code] ?? "Something went wrong",
    detail: error.message,
    actions: errorActions(error),
  };
}

/* -------------------------------------------------------------------------- */
/* success projections                                                        */
/* -------------------------------------------------------------------------- */

type AnyRecord = Record<string, any>;

function productResults(
  data: AnyRecord,
  input: AnyRecord
): ProductResultsPart | null {
  const products = (data.products ?? []).slice(0, MAX_PRODUCTS_PER_PART);
  if (products.length === 0) return null;

  const query = typeof input?.q === "string" ? input.q : undefined;

  return {
    type: "product_results",
    partId: nextPartId("products"),
    query,
    products,
    // Only offered when there genuinely is more, so the customer is never sent to an empty page.
    moreHref: data.hasMore
      ? `${env.PUBLIC_APP_URL}/products${query ? `?q=${encodeURIComponent(query)}` : ""}`
      : undefined,
  };
}

/**
 * The one place a tool result becomes a widget.
 *
 * Returns null for tools whose output the model should simply narrate (`list_orders`,
 * `get_order`) — a widget for every call would turn the transcript into a dashboard.
 */
export function toolResultToPart(
  name: string,
  input: unknown,
  result: ToolResult
): MessagePart | null {
  if (!result.ok) return toErrorPart(result.error);

  const data = (result.data ?? {}) as AnyRecord;
  const args = (input ?? {}) as AnyRecord;

  switch (name) {
    case "search_products":
    case "list_related_products":
      return productResults(data, args);

    case "get_product":
      return data.product
        ? {
            type: "product_results",
            partId: nextPartId("products"),
            products: [data.product],
          }
        : null;

    case "list_categories": {
      const categories = data.categories ?? [];
      if (categories.length === 0) return null;
      return {
        type: "quick_replies",
        partId: nextPartId("categories"),
        options: categories.map((category: AnyRecord) => ({
          id: category.slug,
          label: category.name,
          send: `Show me ${category.name}`,
        })),
      };
    }

    case "get_cart":
    case "add_to_cart":
    case "update_cart_item":
    case "remove_from_cart":
    case "clear_cart":
      return {
        type: "cart_summary",
        partId: nextPartId("cart"),
        snapshot: {
          itemCount: data.itemCount ?? 0,
          subtotal: data.subtotal ?? 0,
          deliveryFee: data.deliveryFee ?? 0,
          total: data.total ?? 0,
        },
        cta: (data.itemCount ?? 0) > 0 ? "checkout" : "none",
      };

    case "list_addresses":
      return {
        type: "address_picker",
        partId: nextPartId("addresses"),
        addresses: data.addresses ?? [],
        selectedId: (data.addresses ?? []).find((a: AnyRecord) => a.isDefault)?.id,
        allowAdd: true,
      };

    case "create_address":
      return data.address
        ? {
            type: "address_picker",
            partId: nextPartId("addresses"),
            addresses: [data.address],
            selectedId: data.address.id,
            allowAdd: false,
          }
        : null;

    case "list_delivery_slots":
      return {
        type: "slot_picker",
        partId: nextPartId("slots"),
        slots: (data.slots ?? []).map((slot: AnyRecord) => ({
          id: slot.id,
          day: slot.day,
          time: slot.time,
        })),
      };

    case "get_payment_status":
      return {
        type: "reserve_pay_status",
        partId: nextPartId("reserve"),
        state: data.state ?? "none",
        mandate: data.mandate,
        needed: data.needed,
        actions: data.actions ?? [],
      };

    case "check_reserve_pay_status":
      // The polling tool. "found" means we reached the provider; the mandate's own status says
      // whether the customer has actually approved it yet.
      if (data.state === "none" || !data.mandate) {
        return {
          type: "reserve_pay_status",
          partId: nextPartId("reserve"),
          state: "none",
          actions: ["setup"],
        };
      }
      return {
        type: "reserve_pay_status",
        partId: nextPartId("reserve"),
        state: data.mandate.status === "active" ? "active" : data.mandate.status,
        mandate: data.mandate,
        actions: data.mandate.status === "active" ? [] : ["renew", "use_web_checkout"],
      };

    case "start_reserve_pay_setup": {
      const amount = typeof args.amountInRupees === "number" ? args.amountInRupees : undefined;
      return {
        type: "reserve_pay_setup",
        partId: nextPartId("setup"),
        mode: "setup",
        // The block exists at the provider; what's missing is the customer's PIN approval, and
        // that deep link is the only step in this whole flow that needs a human.
        step: "awaiting_approval",
        suggestedAmounts: suggestReserveAmounts(amount ?? 0),
        minAmount: RESERVE_PAY_MIN_AMOUNT,
        maxAmount: RESERVE_PAY_MAX_AMOUNT,
        validityDays: RESERVE_PAY_DEFAULT_EXPIRY_DAYS,
        amount,
        intent: data.intentUrl
          ? {
              upiUri: data.intentUrl,
              expiresAt: data.mandate?.expiredAt ?? new Date().toISOString(),
            }
          : undefined,
      };
    }

    case "prepare_order": {
      if (!data.address || !data.slot) return null;
      return {
        type: "order_review",
        partId: nextPartId("review"),
        lines: data.lines ?? [],
        address: data.address,
        slot: data.slot,
        totals: data.totals,
        payment: data.payment,
        editable: ["cart", "address", "slot"],
      };
    }

    case "place_order": {
      const order = data.order;
      if (!order) return null;
      return {
        type: "order_confirmation",
        partId: nextPartId("confirm"),
        orderNumber: order.orderNumber,
        total: order.total,
        slotLabel: order.deliverySlot,
        addressOneLine: order.addressOneLine,
        paymentId: order.paymentId ?? "",
        debited: data.debited ?? order.total,
        remainingAfter: data.remainingAfter ?? 0,
        href: `${env.PUBLIC_APP_URL}/orders/${order.id}`,
      };
    }

    // list_orders / get_order: the model narrates. A widget per order lookup would turn the
    // transcript into a dashboard.
    default:
      return null;
  }
}

/**
 * Collapses a turn's parts before they go out.
 *
 * Three `add_to_cart` calls in one message produce three identical-in-kind cart summaries; the
 * customer wants the final one. Applies only to `live`-lifecycle widget kinds — parts that
 * reflect current state and are therefore safe to deduplicate. Transient parts (a slot picker,
 * an order review, an error) each represent a distinct conversational commitment and are all
 * kept, in order.
 */
const COLLAPSIBLE: ReadonlySet<string> = new Set(["cart_summary"]);

export function isCollapsible(type: MessagePart["type"]): boolean {
  return COLLAPSIBLE.has(type);
}

export function collapseParts(parts: MessagePart[]): MessagePart[] {
  const lastIndexByType = new Map<string, number>();
  parts.forEach((part, index) => {
    if (COLLAPSIBLE.has(part.type)) lastIndexByType.set(part.type, index);
  });

  return parts.filter((part, index) => {
    if (!COLLAPSIBLE.has(part.type)) return true;
    return lastIndexByType.get(part.type) === index;
  });
}
