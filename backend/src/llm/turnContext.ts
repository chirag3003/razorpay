import * as addressService from "../services/addressService";
import * as cartService from "../services/cartService";
import * as mandateService from "../services/mandateService";
import * as reservePayService from "../services/reservePayService";
import { toAgentMandate } from "../agent-interfaces/tools/presenters";
import { addressOneLine } from "../agent-interfaces/tools/presenters";
import type { WidgetActionInput } from "../schemas/chat.schema";

/**
 * The server-truth context block, rebuilt from the database at the start of every turn.
 *
 * Two reasons this exists rather than letting the model discover state by calling tools:
 *
 * 1. **`clientState` cannot be trusted.** The request carries a cart snapshot and a mandate from
 *    the browser. Both can be stale, and both can be forged. We read `route` and `recentActions`
 *    from it — hints about what the customer is looking at — and rebuild everything that could
 *    influence a purchase from Postgres.
 * 2. **Latency.** Without it, nearly every conversation opens with three tool round-trips
 *    (get_cart, list_addresses, get_payment_status) before the model can say anything useful.
 *    Three DB reads on our side is much cheaper than three model turns.
 *
 * Deliberately *not* included: the product catalog (that is what search is for) and order history
 * (rarely relevant, and list_orders is one call away).
 */

const MAX_LINES_SHOWN = 12;

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
 * The Reserve Pay line, read locally.
 *
 * No Razorpay round trip: this runs on every single turn, and a provider hiccup must not stall a
 * conversation about which brand of milk to buy. The model is told the figures are local — if it
 * is about to act on the balance it should call get_payment_status, which does sync.
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
    lines.push(
      `Cart: ${cart.itemCount} item(s) · subtotal ₹${cart.subtotal} · delivery ₹${cart.deliveryFee} · total ₹${cart.total}`
    );
    for (const item of cart.items.slice(0, MAX_LINES_SHOWN)) {
      lines.push(
        `  - ${item.product.name} (${item.product.unit}) × ${item.qty} @ ₹${item.product.price} · itemId ${item.itemId}`
      );
    }
    if (cart.items.length > MAX_LINES_SHOWN) {
      lines.push(`  - …and ${cart.items.length - MAX_LINES_SHOWN} more (call get_cart for all)`);
    }
  }

  if (addresses.length === 0) {
    lines.push("Addresses: none saved. create_address is required before checkout.");
  } else {
    lines.push(`Addresses (${addresses.length}):`);
    for (const address of addresses) {
      lines.push(
        `  - ${address.id} · ${address.type}${address.isDefault ? " (default)" : ""} · ${addressOneLine(address)}`
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
    // The frontend batches cart taps made outside the chat and sends them with the next turn.
    // Without this the model re-adds what the customer already added by hand.
    lines.push(`Since your last message the customer did this on the site: ${recent}.`);
  }

  return lines.join("\n");
}
