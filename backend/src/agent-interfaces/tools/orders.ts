import * as orderService from "../../services/orderService";
import { getOrderSchema, listOrdersSchema } from "../../schemas/agent-tool.schema";
import { toAgentOrder, toAgentOrderSummary } from "./presenters";
import { NotFoundError } from "../../errors";
import { defineTool, toolError } from "./types";

// Read-only by design: nothing here cancels an order, changes its status, or issues a refund.
// Those stay admin actions.

const listOrders = defineTool({
  name: "list_orders",
  description:
    "The customer's recent orders, newest first, as summaries without line items. Use get_order " +
    "for the contents of a specific one.",
  input: listOrdersSchema,
  readOnly: true,
  handler: async (ctx, input) => {
    const { items, total } = await orderService.listOrders(ctx.userId, { limit: input.limit });

    return {
      orders: items.map(toAgentOrderSummary),
      // The full count, not the page's — the model should be able to say "3 of 12".
      total,
    };
  },
});

const getOrder = defineTool({
  name: "get_order",
  description:
    "One order in full — items, totals, delivery slot, address and current status. Accepts " +
    'either an orderId or the customer-facing order number ("FC-…").',
  input: getOrderSchema,
  readOnly: true,
  handler: async (ctx, input) => {
    // Both service calls scope to ctx.userId and answer NotFoundError rather than "forbidden",
    // so neither can probe whether an id or a number belongs to somebody else.
    try {
      const order = input.orderId
        ? await orderService.getOrderById(ctx.userId, input.orderId)
        : await orderService.getOrderByNumber(ctx.userId, input.orderNumber!);

      return { order: toAgentOrder(order) };
    } catch (err) {
      if (err instanceof NotFoundError) {
        toolError(
          "not_found",
          `No order ${input.orderNumber ? `numbered ${input.orderNumber}` : "with that id"}.`,
          { hint: "Call list_orders to see the customer's recent orders." }
        );
      }
      throw err;
    }
  },
});

export const orderTools = [listOrders, getOrder];
