import type { ClientTurnInput, WidgetActionInput } from "../schemas/chat.schema";

/**
 * Client turn -> the text the model reads. Every turn is flattened into one user message rather
 * than giving the model a structured side-band it would have to be taught to read.
 *
 * Widget taps are bracketed and marked as UI events so the model treats them as facts about what
 * happened, not as words the customer typed — otherwise it replies "you said address.select".
 *
 * `review.confirm` never reaches the model at all: chatService intercepts that turn and calls
 * place_order directly. See services/chatService.ts.
 */

function describeAction(action: WidgetActionInput): string {
  switch (action.type) {
    case "quick_reply":
      return action.text;

    case "cart.add":
      return `[UI] The customer tapped add on ${action.name} (qty ${action.qty}). Their cart is already updated — confirm briefly, don't add it again.`;

    case "cart.set_qty":
      return `[UI] The customer set a cart line to qty ${action.qty} themselves. Already applied.`;

    case "cart.remove":
      return "[UI] The customer removed a line from their cart themselves. Already applied.";

    case "cart.checkout":
      return "[UI] The customer tapped checkout. Take them through the checkout sequence.";

    case "address.select":
      return `[UI] The customer chose the delivery address ${action.addressId} (${action.oneLine}). Use this addressId for prepare_order.`;

    case "address.add_requested":
      return "[UI] The customer wants to add a new address. Ask for each field, then call create_address.";

    case "address.created":
      return `[UI] The customer saved a new address ${action.addressId} (${action.oneLine}).`;

    case "slot.select":
      return `[UI] The customer chose the delivery slot "${action.slotId}" (${action.label}). Use this slotId for prepare_order.`;

    case "review.edit":
      return `[UI] The customer wants to change the ${action.target} on the order they were reviewing. That quote is no longer valid — help them change it, then call prepare_order again.`;

    case "review.confirm":
      // Unreachable: chatService intercepts a confirm turn before this runs. Here for exhaustiveness.
      return "[UI] The customer confirmed the order. Place it now with place_order using the open quoteId.";

    case "reserve_pay.choose_amount":
      return `[UI] The customer chose to reserve ₹${action.amount} (${action.mode}). Call start_reserve_pay_setup with that amount.`;

    case "reserve_pay.intent_opened":
      return "[UI] The customer opened the UPI approval link. Poll check_reserve_pay_status and tell them what you see.";

    case "reserve_pay.approved_claim":
      return "[UI] The customer says they approved the mandate in their UPI app. Verify with check_reserve_pay_status before believing it — approvals take a moment to land.";

    case "reserve_pay.cancel":
      return "[UI] The customer cancelled setting up a reserved balance. Don't push it; offer normal web checkout instead.";

    case "reserve_pay.top_up":
      return "[UI] The customer wants to top up their reserved balance. Work out a sensible amount from their cart total and call start_reserve_pay_setup.";

    case "reserve_pay.renew":
      return "[UI] The customer wants to set up a fresh reserved balance. Call start_reserve_pay_setup.";

    case "fallback.web_checkout":
      return "[UI] The customer chose to check out on the website instead. Point them at the cart page and stop pushing chat checkout.";

    case "retry":
      return "[UI] The customer tapped retry on the last failure. Attempt the same thing once more.";
  }
}

export function turnToUserText(turn: ClientTurnInput): string {
  switch (turn.kind) {
    case "text":
      return turn.text;
    case "widget_action":
      return describeAction(turn.action);
    case "resume":
      // Never sent to the model — chatService replays stored parts instead of running a turn.
      return "";
  }
}

/** First user message, trimmed, for the conversation list. */
export function deriveTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 80 ? `${clean.slice(0, 77)}…` : clean;
}
