import type { DiscoveredTool } from "../connections/types.ts";

/**
 * Three classes, ordered by how much damage a wrong call does.
 *
 * `money` is separated from `write` because the recovery differs: a bad write is usually
 * reversible by another tool call, a bad payment is not.
 */
export type ToolClass = "read" | "write" | "money";

const MONEY_NAME = /\bpay|purchase|checkout|order|charge|buy|debit|billing|subscribe|subscription|refund|transfer|invoice/i;
const MONEY_ARG = /^(amount|total|price|cost|sum|value|subtotal|grand_?total|amount_?in_?\w+)$/i;
const DESTRUCTIVE_NAME = /delete|remove|destroy|drop|revoke|cancel|clear|purge|reset|archive/i;

/**
 * Classify a tool before we know its arguments.
 *
 * Precedence: an explicit user override wins; then the server's own annotations; then name and
 * description heuristics. The heuristics exist because A2A carries no annotations at all and
 * plenty of MCP servers ship none either — without them every unknown tool would be `write`, the
 * user would approve everything reflexively, and the gate would be theatre.
 */
export function classifyTool(tool: DiscoveredTool, override?: ToolClass): ToolClass {
  if (override) return override;

  const haystack = `${tool.name} ${tool.description}`;

  // A server that says "this moves money" is believed even if it also says read-only.
  if (MONEY_NAME.test(haystack)) return "money";

  const a = tool.annotations;
  if (a?.readOnlyHint === true) return "read";
  if (a?.destructiveHint === true) return "write";

  if (DESTRUCTIVE_NAME.test(tool.name)) return "write";

  // A2A skills are free-text instructions to another agent; we cannot see what they will do.
  if (tool.kind === "a2a") return "write";

  // MCP tools that declared no annotations at all: assume they mutate unless the name says query.
  if (!a) {
    return /^(get|list|search|read|find|fetch|show|query|browse|lookup|describe|view|check)[_-]?/i.test(
      tool.name,
    )
      ? "read"
      : "write";
  }

  return "write";
}

/**
 * Re-classify once arguments are known. A generically-named tool carrying `{ amount: 4999 }` is a
 * payment regardless of what it is called.
 */
export function classifyCall(tool: DiscoveredTool, args: unknown, override?: ToolClass): ToolClass {
  const base = classifyTool(tool, override);
  if (override || base === "money") return base;
  return detectAmount(args) !== null ? "money" : base;
}

/**
 * Best-effort scan for a monetary amount in a tool call's arguments.
 *
 * Deliberately shallow and deliberately conservative: it walks two levels, only accepts finite
 * positive numbers under a money-shaped key, and returns the largest match. It cannot know the
 * currency, cannot see an amount the server computes internally, and will miss anything named
 * unusually. That is why the cap it feeds is a second line of defence behind human confirmation,
 * never a substitute for it.
 */
export function detectAmount(args: unknown, depth = 0): number | null {
  if (depth > 2 || args === null || typeof args !== "object") return null;

  let best: number | null = null;
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0 && MONEY_ARG.test(key)) {
      best = best === null ? value : Math.max(best, value);
      continue;
    }
    if (value !== null && typeof value === "object") {
      const nested = detectAmount(value, depth + 1);
      if (nested !== null) best = best === null ? nested : Math.max(best, nested);
    }
  }
  return best;
}
