import { z } from "zod";
import { DomainError } from "../../errors";
import { ToolFailure } from "./types";
import type { ToolContext, ToolDefinition, ToolError, ToolResult } from "./types";
import { catalogTools } from "./catalog";
import { cartTools } from "./cart";
import { checkoutTools } from "./checkout";
import { orderTools } from "./orders";

/**
 * The one place every AI-callable action is registered.
 *
 * The first-party chat agent calls `runTool` in-process; the A2A and MCP adapters will wrap this
 * same map without adding a tool of their own. That's root Hard Rule #2 ("one service layer, two
 * callers") applied one level up — if an action isn't here, no agent can perform it, and if it is
 * here, every agent performs it identically.
 */
const ALL_TOOLS: ToolDefinition<z.ZodType>[] = [
  ...catalogTools,
  ...cartTools,
  ...checkoutTools,
  ...orderTools,
];

export const TOOLS: Record<string, ToolDefinition<z.ZodType>> = Object.fromEntries(
  ALL_TOOLS.map((tool) => [tool.name, tool])
);

export function listTools() {
  return ALL_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    readOnly: tool.readOnly,
  }));
}

/**
 * Anthropic tool definitions, generated from the Zod inputs.
 *
 * Zod 4 ships `toJSONSchema` natively, so there's no second schema to hand-write and drift from
 * the validator — which is what backend/CLAUDE.md asks for. `io: "input"` matters: without it,
 * fields carrying `.default()` are emitted as *required*, and a model would be forced to supply
 * every optional filter on every call.
 */
export function toAnthropicTools() {
  return ALL_TOOLS.map((tool) => {
    const schema = z.toJSONSchema(tool.input, { io: "input" }) as Record<string, unknown>;
    delete schema.$schema;
    return {
      name: tool.name,
      description: tool.description,
      input_schema: schema,
    };
  });
}

/** Same schemas, shaped for an MCP server's `tools/list`. */
export function toMcpTools() {
  return toAnthropicTools().map(({ name, description, input_schema }) => ({
    name,
    description,
    inputSchema: input_schema,
  }));
}

/**
 * Maps a thrown error onto a structured tool failure.
 *
 * The `hint` is the important field. A model that receives an exception stalls or invents a
 * recovery; one that receives "the cart is empty, add items with add_to_cart first" simply does
 * that. Every code here earns its hint.
 */
function mapError(err: unknown): ToolError {
  if (err instanceof DomainError) {
    switch (err.code) {
      case "NOT_FOUND":
        return { code: "not_found", message: err.message, retryable: false };

      case "EMPTY_CART":
        return {
          code: "cart_empty",
          message: err.message,
          retryable: false,
          hint: "Add items with add_to_cart before trying to check out.",
        };

      case "INVALID_ADDRESS":
        return {
          code: "invalid_address",
          message: err.message,
          retryable: false,
          hint: "Call list_addresses for valid address ids, or create_address to add one.",
        };

      case "MANDATE_NOT_ACTIVE":
        return {
          code: "mandate_missing",
          message: err.message,
          retryable: false,
          hint: "The customer has no usable Reserve Pay balance. Call get_payment_status to see what is needed, then start_reserve_pay_setup.",
        };

      case "MANDATE_EXPIRED":
        return {
          code: "mandate_expired",
          message: err.message,
          retryable: false,
          hint: "Ask the customer to set up a new Reserve Pay balance with start_reserve_pay_setup.",
        };

      case "MANDATE_AMOUNT_EXCEEDED":
        return {
          code: "amount_exceeds_mandate_limit",
          message: err.message,
          retryable: false,
          hint: "This single order exceeds the per-transaction limit on the customer's block. Reduce the cart or set up a larger block.",
        };

      case "INSUFFICIENT_BLOCKED_BALANCE":
        return {
          code: "reserve_insufficient",
          message: err.message,
          retryable: false,
          hint: "Call get_payment_status for the shortfall, then offer to top up with start_reserve_pay_setup.",
        };

      case "PAYMENT_GATEWAY_ERROR":
        return {
          code: "payment_gateway_unavailable",
          message: err.message,
          retryable: true,
          hint: "The payment provider rejected the request. Tell the customer and offer to retry shortly.",
        };

      case "PAYMENT_VERIFICATION_FAILED":
        return {
          code: "payment_declined",
          message: err.message,
          retryable: false,
          hint: "Do not retry automatically. Tell the customer to check their order history before trying again.",
        };

      case "CONFLICT":
        return { code: "conflict", message: err.message, retryable: true };

      case "UNAUTHORIZED":
      case "FORBIDDEN":
        return { code: "not_found", message: "Not available", retryable: false };

      default:
        return { code: "server", message: err.message, retryable: true };
    }
  }

  // Anything unmapped is a bug in our code, not something the model did. Log it for us, and give
  // the model a plain retryable failure rather than leaking an internal message into a chat.
  console.error("Unhandled error in tool handler:", err);
  return {
    code: "server",
    message: "Something went wrong on our side.",
    retryable: true,
  };
}

/**
 * The only entry point. Validates input, runs the handler, and **never throws** — an LLM cannot
 * catch an exception, so every failure comes back as data it can act on.
 */
export async function runTool(
  ctx: ToolContext,
  name: string,
  rawInput: unknown = {}
): Promise<ToolResult> {
  const tool = TOOLS[name];

  if (!tool) {
    return {
      ok: false,
      error: {
        code: "not_found",
        message: `No tool named "${name}".`,
        retryable: false,
        hint: `Available tools: ${Object.keys(TOOLS).join(", ")}`,
      },
    };
  }

  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");

    return {
      ok: false,
      error: {
        code: "invalid_input",
        message: `Invalid arguments for ${name}. ${issues}`,
        retryable: true,
        hint: "Fix the arguments and call the tool again.",
      },
    };
  }

  try {
    return { ok: true, data: await tool.handler(ctx, parsed.data) };
  } catch (err) {
    if (err instanceof ToolFailure) return { ok: false, error: err.failure };
    return { ok: false, error: mapError(err) };
  }
}
