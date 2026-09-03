import { z } from "zod";
import { DomainError } from "../../errors";
import { logger } from "../../logger";
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

  // Unmapped means a bug on our side, not a model error. runTool logs the raw err with full
  // tool/actor context; the model only ever sees the generic message below.
  return {
    code: "server",
    message: "Something went wrong on our side.",
    retryable: true,
  };
}

/**
 * `unhandled` never reaches a wire format — it exists only so runTool's log line can show the
 * actual bug (via logger.error's stack-frame detail) rather than the generic message the model
 * receives in `result`.
 */
async function execute(
  ctx: ToolContext,
  name: string,
  rawInput: unknown
): Promise<{ result: ToolResult; unhandled?: unknown }> {
  const tool = TOOLS[name];

  if (!tool) {
    return {
      result: {
        ok: false,
        error: {
          code: "not_found",
          message: `No tool named "${name}".`,
          retryable: false,
          hint: `Available tools: ${Object.keys(TOOLS).join(", ")}`,
        },
      },
    };
  }

  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");

    return {
      result: {
        ok: false,
        error: {
          code: "invalid_input",
          message: `Invalid arguments for ${name}. ${issues}`,
          retryable: true,
          hint: "Fix the arguments and call the tool again.",
        },
      },
    };
  }

  try {
    return { result: { ok: true, data: await tool.handler(ctx, parsed.data) } };
  } catch (err) {
    if (err instanceof ToolFailure) return { result: { ok: false, error: err.failure } };

    const mapped = mapError(err);
    // A DomainError's message is already the real detail runTool will log (mapped.message).
    // Only an unmapped bug needs the raw error surfaced instead, so its stack frame is locatable.
    return { result: { ok: false, error: mapped }, unhandled: err instanceof DomainError ? undefined : err };
  }
}

/**
 * The only entry point. Never throws — an LLM cannot catch an exception, so failures are data.
 *
 * Also the single chokepoint every AI-callable action passes through, from either surface (chat's
 * agentLoop or MCP's buildMcpServer) — which is what makes one log line here cover both, rather
 * than instrumenting the two callers separately.
 */
export async function runTool(
  ctx: ToolContext,
  name: string,
  rawInput: unknown = {}
): Promise<ToolResult> {
  const startedAt = Date.now();
  const { result, unhandled } = await execute(ctx, name, rawInput);
  const fields = { actor: `${ctx.actor.type}:${ctx.actor.id.slice(0, 8)}`, ms: Date.now() - startedAt };

  if (result.ok) {
    logger.info("tool", name, { ...fields, result: "ok" });
  } else {
    // Every failure logs at ERROR, expected domain errors included — "which errors are
    // occurring" is the whole point. `unhandled` swaps in the raw error so a genuine bug's stack
    // frame is locatable; a mapped DomainError's own message is already the real detail.
    logger.error("tool", `${name}  code=${result.error.code}`, unhandled ?? result.error.message, fields);
  }

  return result;
}
