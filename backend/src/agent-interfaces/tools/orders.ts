import { eq } from "drizzle-orm";
import { db } from "../../db";
import { orders } from "../../db/schema";
import * as orderService from "../../services/orderService";
import { getOrderSchema, listOrdersSchema } from "../../schemas/agent-tool.schema";
import { toAgentOrder, toAgentOrderSummary } from "./presenters";
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
    // orderService.listOrders has no limit and hydrates every order, so the slice happens after
    // the fact; the schema caps `limit` at 10 to bound it. Push the limit into the service if
    // order history ever gets long.
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
      // Not filtered by user here: getOrderById below does the ownership check, and answers
      // "not found" rather than "forbidden" so this cannot probe whether a number exists.
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
