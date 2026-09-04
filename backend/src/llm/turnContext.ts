import { MAX_CONTEXT_ADDRESSES } from "../constants";
import * as addressService from "../services/addressService";
import * as cartService from "../services/cartService";
import * as mandateService from "../services/mandateService";
import * as reservePayService from "../services/reservePayService";
import { toAgentMandate } from "../agent-interfaces/tools/presenters";
import { addressOneLine } from "../agent-interfaces/tools/presenters";
import type { WidgetActionInput } from "../schemas/chat.schema";

/**
 * Server-truth context, rebuilt from the database every turn, for two reasons: `clientState` can
 * be stale or forged, so only `route` and `recentActions` are read from it and anything that
 * could influence a purchase is rebuilt from Postgres; and without it nearly every conversation
 * opens with three tool round trips before the model can say anything useful.
 *
 * Not included: the catalog (that is what search is for), order history (list_orders is one call
 * away), and cart line items — only the aggregate. Item detail must come from a live get_cart, so
 * the widget renders and a multi-round turn cannot act on a stale snapshot.
 */

function formatRecentActions(actions: WidgetActionInput[]): string | null {
  const notes = actions
    .map((action) => {
      switch (action.type) {
        case "cart.add":
          return `added ${action.qty}× ${action.name}`;
        case "cart.set_qty":
          return `set a cart line to qty ${action.qty}`;
        case "cart.remove":
          return "removed a cart line";
        case "cart.checkout":
          return "tapped checkout";
        case "address.select":
          return `chose the address ${action.oneLine}`;
        case "slot.select":
          return `chose the ${action.label} slot`;
        default:
          return null;
      }
    })
    .filter((note): note is string => note !== null);

  return notes.length > 0 ? notes.join("; ") : null;
}

/**
 * Read locally, no Razorpay round trip — this runs every turn and a provider hiccup must not
 * stall a conversation. get_payment_status is the one that syncs.
 */
async function reservePayLine(userId: string): Promise<string> {
  const live = await reservePayService.getLiveMandate(userId);
  if (!live) return "Reserve Pay: not set up (no reserved balance).";

  const mandate = toAgentMandate(reservePayService.presentMandate(live));
  const expiry = mandate.expiredAt ? new Date(mandate.expiredAt).toISOString().slice(0, 10) : "—";

  return (
    `Reserve Pay: ${mandate.status} (${mandate.detailedStatus}) · ₹${mandate.amountBlocked} blocked · ` +
    `₹${mandate.amountDebited} used · ₹${mandate.remaining} available · per-order cap ₹${mandate.maxAmount} · ` +
    `expires ${expiry}`
  );
}

export async function buildTurnContext(input: {
  userId: string;
  route: string;
  recentActions: WidgetActionInput[];
}): Promise<string> {
  const cartId = await cartService.getOrCreateActiveCartId(input.userId);

  const [cart, addresses, reservePay, openQuote] = await Promise.all([
    cartService.getCartWithTotals(cartId),
    addressService.listAddresses(input.userId),
    reservePayLine(input.userId),
    mandateService.getOpenCartMandate(input.userId),
  ]);

  const lines: string[] = [
    "CURRENT CONTEXT — server truth, refreshed this turn. Trust this over what the customer says.",
    `Now: ${new Date().toISOString()}`,
    `Customer is on: ${input.route}`,
  ];

  if (cart.items.length === 0) {
    lines.push("Cart: empty.");
  } else {
    // No per-item breakdown: line items and itemIds must come from a live get_cart, so the
    // widget renders and the numbers cannot drift from a top-of-turn snapshot.
    lines.push(
      `Cart: ${cart.itemCount} item(s) · subtotal ₹${cart.subtotal} · delivery ₹${cart.deliveryFee} · total ₹${cart.total}. ` +
        `Call get_cart for the line items — do not guess them.`
    );
  }

  if (addresses.length === 0) {
    lines.push("Addresses: none saved. create_address is required before checkout.");
  } else {
    // Default first, then the rest in their existing order, capped. `addresses` has no createdAt
    // column, so "most recent N" is not available — and is not worth a column for this.
    const ordered = [...addresses].sort(
      (a, b) => Number(b.isDefault) - Number(a.isDefault)
    );
    const shown = ordered.slice(0, MAX_CONTEXT_ADDRESSES);

    lines.push(`Addresses (${addresses.length}):`);
    for (const address of shown) {
      lines.push(
        `  - ${address.id} · ${address.type}${address.isDefault ? " (default)" : ""} · ${addressOneLine(address)}`
      );
    }

    if (addresses.length > shown.length) {
      lines.push(
        `  …and ${addresses.length - shown.length} more. Call list_addresses for the full list — ` +
          `do not assume an address that isn't shown here is missing.`
      );
    }
  }

  lines.push(reservePay);

  if (openQuote) {
    const expired = openQuote.expiresAt.getTime() < Date.now();
    lines.push(
      expired
        ? `Open quote: ${openQuote.id} for ₹${openQuote.snapshot.total} — EXPIRED. Call prepare_order again.`
        : `Open quote: ${openQuote.id} for ₹${openQuote.snapshot.total}, awaiting the customer's Confirm tap (expires ${openQuote.expiresAt.toISOString()}).`
    );
  } else {
    lines.push("Open quote: none.");
  }

  const recent = formatRecentActions(input.recentActions);
  if (recent) {
    // The frontend batches cart taps made outside the chat into the next turn. Without this the
    // model re-adds what the customer already added by hand.
    lines.push(`Since your last message the customer did this on the site: ${recent}.`);
  }

  return lines.join("\n");
}
