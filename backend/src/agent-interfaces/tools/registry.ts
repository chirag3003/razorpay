import { z } from "zod";
import { DomainError } from "../../errors";
import { ToolFailure } from "./types";
import type { ToolContext, ToolDefinition, ToolError, ToolResult } from "./types";
import { catalogTools } from "./catalog";
import { cartTools } from "./cart";
import { checkoutTools } from "./checkout";
import { orderTools } from "./orders";

// Every AI-callable action. The chat agent (in-process runTool) and the MCP adapter both wrap
// this map without adding tools of their own — root Hard Rule #2 applied one level up.
export const ALL_TOOLS: ToolDefinition<z.ZodType>[] = [
  ...catalogTools,
  ...cartTools,
  ...checkoutTools,
  ...orderTools,
];

export const TOOLS: Record<string, ToolDefinition<z.ZodType>> = Object.fromEntries(
  ALL_TOOLS.map((tool) => [tool.name, tool])
);

/**
 * Zod inputs as OpenAI-compatible function definitions. `io: "input"` is required: without it
 * `.default()` fields are emitted as required and a model must supply every filter on every call.
 *
 * `filter` implements chatService's `place_order` gate — a tool absent from the array cannot be
 * called, which no system-prompt rule can guarantee.
 */
export function toOpenAITools(filter?: (tool: ToolDefinition<z.ZodType>) => boolean) {
  return ALL_TOOLS.filter(filter ?? (() => true)).map((tool) => {
    const parameters = z.toJSONSchema(tool.input, { io: "input" }) as Record<string, unknown>;
    delete parameters.$schema;
    return {
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters,
      },
    };
  });
}

/** Thrown error -> structured tool failure. The `hint` is what lets a model recover rather than stall. */
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

  // Unmapped means a bug on our side, not a model error. Log it; the model gets a plain
  // retryable failure rather than an internal message leaked into a chat.
  console.error("Unhandled error in tool handler:", err);
  return {
    code: "server",
    message: "Something went wrong on our side.",
    retryable: true,
  };
}

/** The only entry point. Never throws — an LLM cannot catch an exception, so failures are data. */
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
