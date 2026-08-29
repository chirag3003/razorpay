import type { z } from "zod";

/**
 * Who is acting, and on whose behalf.
 *
 * Authentication happens *above* this layer — the AI layer resolves the session and hands the
 * userId in. Tools trust it, exactly as a route handler trusts `c.get("userId")` after
 * requireAuth has run.
 *
 * `actor` is separate from `userId` on purpose. Today they usually name the same person, but when
 * agent tokens land, `actor` becomes `{ type: "agent", id: <token id> }` acting on a user's data —
 * and every audit row written from `ctx.actor` starts attributing correctly with no tool change.
 */
export type ToolContext = {
  actor: { type: "user" | "agent"; id: string };
  userId: string;
  /** Correlates the audit trail for one conversation. */
  conversationId?: string;
};

/**
 * Stable failure codes. Named to line up with the frontend's `ChatErrorCode` union
 * (web/lib/chat/protocol.ts) wherever the two overlap, so the AI layer's mapping from a tool
 * failure to a rendered error widget is mechanical rather than a judgement call.
 */
export const TOOL_ERROR_CODES = [
  "invalid_input",
  "not_found",
  "cart_empty",
  "product_unavailable",
  "invalid_address",
  "invalid_slot",
  "mandate_missing",
  "mandate_expired",
  "mandate_revoked",
  "reserve_insufficient",
  "amount_exceeds_mandate_limit",
  "quote_expired",
  "quote_superseded",
  "cart_changed",
  "payment_declined",
  "payment_gateway_unavailable",
  "conflict",
  "server",
] as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export type ToolError = {
  code: ToolErrorCode;
  message: string;
  /** Whether trying the same call again could plausibly succeed. */
  retryable: boolean;
  /** What the model should do instead. This is what turns a failure into a recovery. */
  hint?: string;
};

export type ToolResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: ToolError };

export type ToolDefinition<S extends z.ZodType = z.ZodType> = {
  name: string;
  /** Written for a model, not a developer — see the descriptions in catalog.ts / cart.ts. */
  description: string;
  input: S;
  /**
   * Root Hard Rule #5: discovery is open, transacting is not. Today every tool receives a userId
   * regardless; this flag is what the future agent-token middleware will gate on, and it keeps
   * the read/write split visible in one place rather than inferred from tool names.
   */
  readOnly: boolean;
  handler: (ctx: ToolContext, input: z.output<S>) => Promise<unknown>;
};

/** Narrowing helper so `defineTool` keeps the input type through the registry map. */
export function defineTool<S extends z.ZodType>(def: ToolDefinition<S>): ToolDefinition<S> {
  return def;
}

/**
 * Thrown by a handler that already knows its own tool-level failure code, for the cases the
 * DomainError hierarchy doesn't cover (an expired quote, an out-of-stock product).
 *
 * Lives here rather than in registry.ts so the tool modules don't have to import the registry
 * that imports them — that cycle happens to work under ESM, since the reference is inside a
 * handler body, but it's a trap for the next person to add a top-level call.
 */
export class ToolFailure extends Error {
  constructor(readonly failure: ToolError) {
    super(failure.message);
    this.name = "ToolFailure";
  }
}

export function toolError(
  code: ToolErrorCode,
  message: string,
  options: { retryable?: boolean; hint?: string } = {}
): never {
  throw new ToolFailure({
    code,
    message,
    retryable: options.retryable ?? false,
    hint: options.hint,
  });
}
