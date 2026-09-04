import type { z } from "zod";

/**
 * Who is acting, and on whose behalf. Authentication happens above this layer; tools trust the
 * userId handed in, as a route handler trusts `c.get("userId")` after requireAuth.
 *
 * `actor` is separate from `userId` because they differ on the MCP surface, where an agent acts
 * on a user's data — audit rows written from `ctx.actor` attribute correctly either way.
 */
export type ToolContext = {
  actor: { type: "user" | "agent"; id: string };
  userId: string;
  /** Correlates the audit trail for one conversation. */
  conversationId?: string;
};

// Named to line up with the frontend's ChatErrorCode union wherever the two overlap, so
// partMapper's failure -> widget mapping is mechanical rather than a judgement call.
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

/** The two callers that wrap the registry: the first-party chat agent, and the MCP server. */
export type ToolSurface = "chat" | "mcp";

export const ALL_SURFACES: readonly ToolSurface[] = ["chat", "mcp"];

export type ToolDefinition<S extends z.ZodType = z.ZodType> = {
  name: string;
  /** Written for a model, not a developer — see the descriptions in catalog.ts / cart.ts. */
  description: string;
  input: S;
  /**
   * Hard Rule #5: discovery is open, transacting is not. Nothing gates on this yet — it keeps the
   * read/write split declared in one place rather than inferred from tool names.
   */
  readOnly: boolean;
  /**
   * Which surfaces offer this tool. Omitted means both.
   *
   * Deliberately separate from chatService's `place_order` filter, which carries an unrelated
   * safety meaning (that tool is never in the chat model's hands at all). This one answers "is
   * this tool useful here", not "is it safe here".
   */
  surfaces?: readonly ToolSurface[];
  handler: (ctx: ToolContext, input: z.output<S>) => Promise<unknown>;
};

/** Whether a tool is offered on a given surface. Absent `surfaces` means every surface. */
export function isOnSurface(tool: ToolDefinition<z.ZodType>, surface: ToolSurface) {
  return (tool.surfaces ?? ALL_SURFACES).includes(surface);
}

/** Narrowing helper so `defineTool` keeps the input type through the registry map. */
export function defineTool<S extends z.ZodType>(def: ToolDefinition<S>): ToolDefinition<S> {
  return def;
}

/**
 * Thrown by a handler that already knows its own failure code, for cases the DomainError
 * hierarchy doesn't cover (expired quote, out-of-stock product).
 *
 * Here rather than in registry.ts so tool modules don't import the registry that imports them.
 * That cycle works under ESM while the reference is inside a handler body, but it is a trap.
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
