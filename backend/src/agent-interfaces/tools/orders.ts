import { eq } from "drizzle-orm";
import { db } from "../../db";
import { orders } from "../../db/schema";
import * as orderService from "../../services/orderService";
import { getOrderSchema, listOrdersSchema } from "../../schemas/agent-tool.schema";
import { toAgentOrder, toAgentOrderSummary } from "./presenters";
import { defineTool, toolError } from "./types";

// Order tools are read-only by design. Nothing here can cancel an order, change its status, or
// issue a refund — those stay admin actions. An agent can look an order up and explain it, and
// that is the whole surface.

const listOrders = defineTool({
  name: "list_orders",
  description:
    "The customer's recent orders, newest first, as summaries without line items. Use get_order " +
    "for the contents of a specific one.",
  input: listOrdersSchema,
  readOnly: true,
  handler: async (ctx, input) => {
    // orderService.listOrders hydrates every order with a join per row and has no limit of its
    // own, so the slice happens after the fact. The schema caps `limit` at 10 to bound that;
    // worth pushing the limit down into the service if order history ever gets long.
    const all = await orderService.listOrders(ctx.userId);

    return {
      orders: all.slice(0, input.limit).map(toAgentOrderSummary),
      total: all.length,
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
    let orderId = input.orderId;

    if (!orderId) {
      // Resolve the human-facing number to an id. Deliberately not filtered by user here —
      // getOrderById below does the ownership check, and it answers "not found" rather than
      // "forbidden" so this can't be used to probe whether an order number exists.
      const [match] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.orderNumber, input.orderNumber!))
        .limit(1);

      if (!match) {
        toolError("not_found", `No order numbered ${input.orderNumber}.`, {
          hint: "Call list_orders to see the customer's recent orders.",
        });
      }

      orderId = match.id;
    }

    const order = await orderService.getOrderById(ctx.userId, orderId);
    return { order: toAgentOrder(order) };
  },
});

export const orderTools = [listOrders, getOrder];
