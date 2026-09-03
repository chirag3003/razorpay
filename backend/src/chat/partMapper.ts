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

// Tool result -> rendered widget. The model has no UI tools: every rupee on screen is projected
// from a tool result, so it cannot misquote a price and catalog data never round-trips through it.
// Shapes must match web/lib/chat/protocol.ts — see chat/protocol.ts for the drift check.

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

// Tool failure codes -> the frontend's narrower ChatErrorCode union. Codes with no frontend
// equivalent fall through to `server` and are explained in prose instead of a red box.
const ERROR_CODE_MAP: Record<string, ChatErrorCode> = {
  mandate_missing: "server",
  mandate_expired: "mandate_expired",
  mandate_revoked: "mandate_revoked",
  reserve_insufficient: "reserve_insufficient",
  amount_exceeds_mandate_limit: "transaction_limit_exceeded",
  payment_declined: "payment_declined",
  payment_gateway_unavailable: "bank_not_available",
};

// Only failures the customer has to act on get a card. The rest (`not_found`, `cart_empty`,
// `invalid_input`) the model recovers from itself using the failure's hint.
const CUSTOMER_FACING_ERRORS = new Set([
  "mandate_expired",
  "mandate_revoked",
  "reserve_insufficient",
  "amount_exceeds_mandate_limit",
  "payment_declined",
  "payment_gateway_unavailable",
  // Confirm is a direct call with no model in the loop (chatService.handlePlaceOrderConfirm),
  // so nothing can narrate these in prose. Unmapped, they would render nothing at all.
  "quote_expired",
  "quote_superseded",
  "cart_changed",
  "conflict",
]);

const ERROR_TITLES: Record<string, string> = {
  mandate_expired: "Your reserved balance has expired",
  mandate_revoked: "Your reserved balance is no longer active",
  reserve_insufficient: "Not enough reserved balance",
  amount_exceeds_mandate_limit: "This order is over your per-order limit",
  payment_declined: "The payment did not go through",
  payment_gateway_unavailable: "The payment provider is unavailable",
  quote_expired: "That order review has expired",
  quote_superseded: "That order review is out of date",
  cart_changed: "Your cart changed since you reviewed it",
  conflict: "That order review could not be verified",
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
      // Never offer a retry: the charge may have succeeded with only its proof suspect, so a
      // retry risks a second debit.
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
    // Only when there is genuinely more — never send the customer to an empty page.
    moreHref: data.hasMore
      ? `${env.PUBLIC_APP_URL}/products${query ? `?q=${encodeURIComponent(query)}` : ""}`
      : undefined,
  };
}

/** Returns null for tools the model should narrate instead (`list_orders`, `get_order`). */
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
        // toAgentCartLine already emits ChatCartLine's exact shape, so this passes straight
        // through. Every cart tool returns them, so add/update/remove all list the new cart.
        lines: data.lines ?? [],
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
      // "found" means the provider was reached; the mandate's own status says whether the
      // customer has approved yet.
      if (data.state === "none" || !data.mandate) {
        return {
          type: "reserve_pay_status",
          partId: nextPartId("reserve"),
          state: "none",
          actions: ["setup"],
        };
      }
      // A block still awaiting approval reaches here as `revoked`, since ChatMandate.status has
      // no `pending`. Rendering that widget would tell the customer their approval failed and
      // offer them "renew" mid-approval. No widget: the setup widget is already on screen with
      // its own approve/retry buttons, and the model's text carries the "not yet" itself.
      if (data.awaitingApproval) return null;

      return {
        type: "reserve_pay_status",
        partId: nextPartId("reserve"),
        state: data.mandate.status === "active" ? "active" : data.mandate.status,
        mandate: data.mandate,
        actions: data.mandate.status === "active" ? [] : ["renew", "use_web_checkout"],
      };

    // Offers amounts without creating anything. The customer picks, and only then does
    // start_reserve_pay_setup below block any funds.
    case "offer_reserve_pay_amounts":
      return {
        type: "reserve_pay_setup",
        partId: nextPartId("setup"),
        // top_up when a block already exists, so the widget says "Top up your reserve" rather
        // than offering a first-time setup the customer has already done.
        mode: data.mode === "top_up" ? "top_up" : "setup",
        step: "choose_amount",
        suggestedAmounts: data.suggestedAmounts ?? [],
        minAmount: RESERVE_PAY_MIN_AMOUNT,
        maxAmount: RESERVE_PAY_MAX_AMOUNT,
        validityDays: RESERVE_PAY_DEFAULT_EXPIRY_DAYS,
      };

    case "start_reserve_pay_setup": {
      const amount = typeof args.amountInRupees === "number" ? args.amountInRupees : undefined;
      return {
        type: "reserve_pay_setup",
        partId: nextPartId("setup"),
        mode: "setup",
        // The block exists at the provider; only the customer's PIN approval is outstanding.
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
              // Already built by the tool via buildUpiIntentLinks — the widget turns these into
              // one button per UPI app instead of showing a raw upi:// string.
              links: data.intentLinks ?? undefined,
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

    default:
      return null;
  }
}

// Widget kinds that reflect current state, so only the last one in a turn is worth emitting —
// three add_to_cart calls should produce one cart summary. Transient parts (slot picker, order
// review, error) each represent a distinct commitment and are all kept, in order.
const COLLAPSIBLE: ReadonlySet<string> = new Set(["cart_summary"]);

export function isCollapsible(type: MessagePart["type"]): boolean {
  return COLLAPSIBLE.has(type);
}
